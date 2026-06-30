"""Implementation of :meth:`AIAgent.__init__` — extracted as a module function.

``AIAgent.__init__`` is one of the longest methods in the codebase (60+
parameters, ~1,400 lines of attribute initialization, provider
auto-detection, credential resolution, context-engine bootstrap, etc.).
Keeping it in ``run_agent.py`` bloats that file with code that's mostly
"setup state, then forget".

After this extraction the body lives here as ``init_agent(agent, ...)``
and :meth:`AIAgent.__init__` is a thin wrapper that calls
``init_agent(self, ...)``.  All imports the body needs at module-load
time are listed below; the body also performs many lazy imports inside
its own scope that come along unchanged.

Symbols that tests patch on ``run_agent.*`` (``OpenAI``, ``cleanup_vm``,
etc.) are resolved through :func:`_ra` so the patch contract is
preserved.
"""

from __future__ import annotations

import logging
import os
import re
import sys
import threading
import time
import uuid
from datetime import datetime
from typing import Any, Callable, Dict, List, Optional
from urllib.parse import urlparse, parse_qs, urlunparse

from agent.context_compressor import ContextCompressor
from agent.iteration_budget import IterationBudget
from agent.memory_manager import StreamingContextScrubber
from agent.model_metadata import (
    MINIMUM_CONTEXT_LENGTH,
    fetch_model_metadata,
    is_local_endpoint,
    query_ollama_num_ctx,
)
from agent.process_bootstrap import _install_safe_stdio
from agent.subdirectory_hints import SubdirectoryHintTracker
from agent.think_scrubber import StreamingThinkScrubber
from agent.tool_guardrails import (
    ToolCallGuardrailConfig,
    ToolCallGuardrailController,
    ToolGuardrailDecision,
)
from hermes_cli.config import cfg_get
from hermes_cli.timeouts import get_provider_request_timeout
from hermes_constants import get_hermes_home
from utils import base_url_host_matches, is_truthy_value

# Use the same logger name as run_agent so tests patching ``run_agent.logger``
# capture our warnings.  (run_agent.py also does
# ``logger = logging.getLogger(__name__)``, which resolves to "run_agent"
# from inside that module.)
logger = logging.getLogger("run_agent")


def _ra():
    """Lazy reference to ``run_agent`` so callers can patch
    ``run_agent.OpenAI`` / ``run_agent.cleanup_vm`` / ... and have those
    patches reach this code path.
    """
    import run_agent
    return run_agent


def _build_codex_gpt55_autoraise_notice(autoraise: Dict[str, float]) -> str:
    """Build the one-time notice shown when Codex gpt-5.5 raises compaction.

    ``autoraise`` is ``{"from": <old_ratio>, "to": <new_ratio>}``. The same
    text is printed inline for CLI users and replayed via ``status_callback``
    for gateway users, so it must be self-contained and include the exact
    opt-back-out command.
    """
    from_pct = int(round(autoraise["from"] * 100))
    to_pct = int(round(autoraise["to"] * 100))
    return (
        f"ℹ Codex gpt-5.5 caps context at 272K, so auto-compaction was raised "
        f"to {to_pct}% (from {from_pct}%) to use more of the window before "
        f"summarizing.\n"
        f"  Opt back out: hermes config set compression.codex_gpt55_autoraise false"
    )


def _normalized_custom_base_url(value: Any) -> str:
    if not isinstance(value, str):
        return ""
    return value.strip().rstrip("/")


def _custom_provider_model_matches(agent_model: str, entry: Dict[str, Any]) -> bool:
    provider_model = str(entry.get("model", "") or "").strip().lower()
    if not provider_model:
        return True
    return provider_model == str(agent_model or "").strip().lower()


def _custom_provider_extra_body_for_agent(
    *,
    provider: str,
    model: str,
    base_url: str,
    custom_providers: List[Dict[str, Any]],
) -> Optional[Dict[str, Any]]:
    provider_norm = (provider or "").strip().lower()
    if provider_norm == "custom":
        provider_key_filter = ""
    elif provider_norm.startswith("custom:"):
        provider_key_filter = provider_norm.split(":", 1)[1].strip()
    else:
        return None

    target_url = _normalized_custom_base_url(base_url)
    if not target_url:
        return None

    fallback: Optional[Dict[str, Any]] = None
    for entry in custom_providers or []:
        if not isinstance(entry, dict):
            continue
        if provider_key_filter:
            entry_keys = {
                str(entry.get("provider_key", "") or "").strip().lower(),
                str(entry.get("name", "") or "").strip().lower(),
            }
            if provider_key_filter not in entry_keys:
                continue
        if _normalized_custom_base_url(entry.get("base_url")) != target_url:
            continue
        extra_body = entry.get("extra_body")
        if not isinstance(extra_body, dict) or not extra_body:
            continue
        provider_model = str(entry.get("model", "") or "").strip()
        if provider_model:
            if _custom_provider_model_matches(model, entry):
                return dict(extra_body)
        elif fallback is None:
            fallback = dict(extra_body)

    return fallback


def _merge_custom_provider_extra_body(agent, custom_providers: List[Dict[str, Any]]) -> None:
    extra_body = _custom_provider_extra_body_for_agent(
        provider=agent.provider,
        model=agent.model,
        base_url=agent.base_url,
        custom_providers=custom_providers,
    )
    if not extra_body:
        return

    overrides = dict(getattr(agent, "request_overrides", {}) or {})
    merged_extra_body = dict(extra_body)
    existing_extra_body = overrides.get("extra_body")
    if isinstance(existing_extra_body, dict):
        merged_extra_body.update(existing_extra_body)
    overrides["extra_body"] = merged_extra_body
    agent.request_overrides = overrides


def init_agent(
    agent,
    base_url: str = None,
    api_key: str = None,
    provider: str = None,
    api_mode: str = None,
    acp_command: str = None,
    acp_args: list[str] | None = None,
    command: str = None,
    args: list[str] | None = None,
    model: str = "",
    max_iterations: int = 90,  # Default tool-calling iterations (shared with subagents)
    # 默认工具调用迭代次数（与子 agent 共享）。
    tool_delay: float = 1.0,
    enabled_toolsets: List[str] = None,
    disabled_toolsets: List[str] = None,
    save_trajectories: bool = False,
    verbose_logging: bool = False,
    quiet_mode: bool = False,
    tool_progress_mode: str = "all",
    ephemeral_system_prompt: str = None,
    log_prefix_chars: int = 100,
    log_prefix: str = "",
    providers_allowed: List[str] = None,
    providers_ignored: List[str] = None,
    providers_order: List[str] = None,
    provider_sort: str = None,
    provider_require_parameters: bool = False,
    provider_data_collection: str = None,
    openrouter_min_coding_score: Optional[float] = None,
    session_id: str = None,
    tool_progress_callback: callable = None,
    tool_start_callback: callable = None,
    tool_complete_callback: callable = None,
    thinking_callback: callable = None,
    reasoning_callback: callable = None,
    clarify_callback: callable = None,
    read_terminal_callback: callable = None,
    step_callback: callable = None,
    stream_delta_callback: callable = None,
    interim_assistant_callback: callable = None,
    tool_gen_callback: callable = None,
    status_callback: callable = None,
    notice_callback: callable = None,
    notice_clear_callback: callable = None,
    event_callback: Optional[Callable[[str, dict], None]] = None,
    max_tokens: int = None,
    reasoning_config: Dict[str, Any] = None,
    service_tier: str = None,
    request_overrides: Dict[str, Any] = None,
    prefill_messages: List[Dict[str, Any]] = None,
    platform: str = None,
    user_id: str = None,
    user_id_alt: str = None,
    user_name: str = None,
    chat_id: str = None,
    chat_name: str = None,
    chat_type: str = None,
    thread_id: str = None,
    gateway_session_key: str = None,
    skip_context_files: bool = False,
    load_soul_identity: bool = False,
    skip_memory: bool = False,
    session_db=None,
    parent_session_id: str = None,
    iteration_budget: "IterationBudget" = None,
    fallback_model: Dict[str, Any] = None,
    credential_pool=None,
    checkpoints_enabled: bool = False,
    checkpoint_max_snapshots: int = 20,
    checkpoint_max_total_size_mb: int = 500,
    checkpoint_max_file_size_mb: int = 10,
    pass_session_id: bool = False,
):
    """
    Initialize the AI Agent.
    初始化 AI Agent。

    Args:
    参数：
        base_url (str): Base URL for the model API (optional)
        base_url (str): 模型 API 的基础 URL（可选）。
        api_key (str): API key for authentication (optional, uses env var if not provided)
        api_key (str): 用于鉴权的 API key（可选；未提供时使用环境变量）。
        provider (str): Provider identifier (optional; used for telemetry/routing hints)
        provider (str): Provider 标识符（可选；用于遥测或路由提示）。
        api_mode (str): API mode override: "chat_completions" or "codex_responses"
        api_mode (str): API 模式覆盖值："chat_completions" 或 "codex_responses"。
        model (str): Model name to use (default: "anthropic/claude-opus-4.6")
        model (str): 要使用的模型名称（默认："anthropic/claude-opus-4.6"）。
        max_iterations (int): Maximum number of tool calling iterations (default: 90)
        max_iterations (int): 工具调用迭代的最大次数（默认：90）。
        tool_delay (float): Delay between tool calls in seconds (default: 1.0)
        tool_delay (float): 工具调用之间的延迟秒数（默认：1.0）。
        enabled_toolsets (List[str]): Only enable tools from these toolsets (optional)
        enabled_toolsets (List[str]): 只启用这些 toolset 中的工具（可选）。
        disabled_toolsets (List[str]): Disable tools from these toolsets (optional)
        disabled_toolsets (List[str]): 禁用这些 toolset 中的工具（可选）。
        save_trajectories (bool): Whether to save conversation trajectories to JSONL files (default: False)
        save_trajectories (bool): 是否把对话轨迹保存到 JSONL 文件（默认：False）。
        verbose_logging (bool): Enable verbose logging for debugging (default: False)
        verbose_logging (bool): 是否启用用于调试的详细日志（默认：False）。
        quiet_mode (bool): Suppress progress output for clean CLI experience (default: False)
        quiet_mode (bool): 是否抑制进度输出，以保持 CLI 输出整洁（默认：False）。
        ephemeral_system_prompt (str): System prompt used during agent execution but NOT saved to trajectories (optional)
        ephemeral_system_prompt (str): agent 执行期间使用、但不会保存到轨迹中的系统提示词（可选）。
        log_prefix_chars (int): Number of characters to show in log previews for tool calls/responses (default: 100)
        log_prefix_chars (int): 工具调用/响应的日志预览中显示的字符数（默认：100）。
        log_prefix (str): Prefix to add to all log messages for identification in parallel processing (default: "")
        log_prefix (str): 添加到所有日志消息前的前缀，用于在并行处理中区分来源（默认：""）。
        providers_allowed (List[str]): OpenRouter providers to allow (optional)
        providers_allowed (List[str]): 允许使用的 OpenRouter providers（可选）。
        providers_ignored (List[str]): OpenRouter providers to ignore (optional)
        providers_ignored (List[str]): 需要忽略的 OpenRouter providers（可选）。
        providers_order (List[str]): OpenRouter providers to try in order (optional)
        providers_order (List[str]): OpenRouter providers 的尝试顺序（可选）。
        provider_sort (str): Sort providers by price/throughput/latency (optional)
        provider_sort (str): 按 price/throughput/latency 对 providers 排序（可选）。
        openrouter_min_coding_score (float): Coding-score floor (0.0-1.0) for the
        openrouter_min_coding_score (float): openrouter/pareto-code router 的 coding-score 下限（0.0-1.0）。
            openrouter/pareto-code router. Only applied when model == "openrouter/pareto-code".
            仅当 model == "openrouter/pareto-code" 时生效。
            None or empty = let OpenRouter pick the strongest available coder.
            None 或空值表示让 OpenRouter 选择可用的最强 coder。
        session_id (str): Pre-generated session ID for logging (optional, auto-generated if not provided)
        session_id (str): 预生成的日志 session ID（可选；未提供时自动生成）。
        tool_progress_callback (callable): Callback function(tool_name, args_preview) for progress notifications
        tool_progress_callback (callable): 用于进度通知的回调函数 function(tool_name, args_preview)。
        clarify_callback (callable): Callback function(question, choices) -> str for interactive user questions.
        clarify_callback (callable): 用于交互式用户问题的回调函数 function(question, choices) -> str。
            Provided by the platform layer (CLI or gateway). If None, the clarify tool returns an error.
            由平台层（CLI 或 gateway）提供；如果为 None，clarify 工具会返回错误。
        max_tokens (int): Maximum tokens for model responses (optional, uses model default if not set)
        max_tokens (int): 模型响应的最大 token 数（可选；未设置时使用模型默认值）。
        reasoning_config (Dict): OpenRouter reasoning configuration override (e.g. {"effort": "none"} to disable thinking).
        reasoning_config (Dict): OpenRouter reasoning 配置覆盖值（例如 {"effort": "none"} 用于禁用 thinking）。
            If None, defaults to {"enabled": True, "effort": "medium"} for OpenRouter. Set to disable/customize reasoning.
            如果为 None，OpenRouter 默认使用 {"enabled": True, "effort": "medium"}；可设置该值来禁用或定制 reasoning。
        prefill_messages (List[Dict]): Messages to prepend to conversation history as prefilled context.
        prefill_messages (List[Dict]): 作为预填上下文追加到对话历史开头的消息。
            Useful for injecting a few-shot example or priming the model's response style.
            适合注入 few-shot 示例，或预先引导模型的回复风格。
            Example: [{"role": "user", "content": "Hi!"}, {"role": "assistant", "content": "Hello!"}]
            示例：[{"role": "user", "content": "Hi!"}, {"role": "assistant", "content": "Hello!"}]
            NOTE: Anthropic Sonnet 4.6+ and Opus 4.6+ reject a conversation that ends on an
            注意：Anthropic Sonnet 4.6+ 和 Opus 4.6+ 会拒绝以
            assistant-role message (400 error).  For those models use structured outputs or
            assistant 角色消息结尾的对话（400 错误）。对这些模型，请使用结构化输出或
            output_config.format instead of a trailing-assistant prefill.
            output_config.format，而不是尾部 assistant 预填消息。
        platform (str): The interface platform the user is on (e.g. "cli", "telegram", "discord", "whatsapp").
        platform (str): 用户所在的交互平台（例如 "cli"、"telegram"、"discord"、"whatsapp"）。
            Used to inject platform-specific formatting hints into the system prompt.
            用于向系统提示词注入平台特定的格式提示。
        skip_context_files (bool): If True, skip auto-injection of project context files
        skip_context_files (bool): 如果为 True，则跳过项目上下文文件的自动注入，
            (SOUL.md, .hermes.md, AGENTS.md, CLAUDE.md, .cursorrules) from the cwd / HERMES_HOME
            这些文件包括来自 cwd / HERMES_HOME 的 SOUL.md、.hermes.md、AGENTS.md、CLAUDE.md、.cursorrules，
            into the system prompt. Use this for batch processing and data generation to avoid
            它们原本会被注入系统提示词。批处理和数据生成场景可使用该选项，以避免
            polluting trajectories with user-specific persona or project instructions.
            用户特定 persona 或项目指令污染轨迹数据。
        load_soul_identity (bool): If True, still use ~/.hermes/SOUL.md as the primary
        load_soul_identity (bool): 如果为 True，即使 skip_context_files=True，仍使用 ~/.hermes/SOUL.md 作为主要
            identity even when skip_context_files=True. Project context files from the cwd
            身份设定。来自 cwd 的项目上下文文件
            remain skipped.
            仍会被跳过。
    """
    _install_safe_stdio()

    agent.model = model
    agent.max_iterations = max_iterations
    # Shared iteration budget — parent creates, children inherit.
    # 共享迭代预算 —— 由父 agent 创建，子 agent 继承。
    # Consumed by every LLM turn across parent + all subagents.
    # 父 agent 与所有子 agent 的每个 LLM turn 都会消耗它。
    agent.iteration_budget = iteration_budget or IterationBudget(max_iterations)
    agent.tool_delay = tool_delay
    agent.save_trajectories = save_trajectories
    agent.verbose_logging = verbose_logging
    agent.quiet_mode = quiet_mode
    agent.tool_progress_mode = tool_progress_mode
    agent.ephemeral_system_prompt = ephemeral_system_prompt
    agent.platform = platform  # "cli", "telegram", "discord", "whatsapp", etc.
    # 平台名称，例如 "cli"、"telegram"、"discord"、"whatsapp" 等。
    agent._user_id = user_id  # Platform user identifier (gateway sessions)
    # 平台用户标识符（gateway sessions）。
    agent._user_id_alt = user_id_alt  # Optional stable alternate platform identifier
    # 可选的稳定备用平台标识符。
    agent._user_name = user_name
    agent._chat_id = chat_id
    agent._chat_name = chat_name
    agent._chat_type = chat_type
    agent._thread_id = thread_id
    agent._gateway_session_key = gateway_session_key  # Stable per-chat key (e.g. agent:main:telegram:dm:123)
    # 稳定的每聊天 key（例如 agent:main:telegram:dm:123）。
    # Pluggable print function — CLI replaces this with _cprint so that
    # 可插拔的打印函数 —— CLI 会用 _cprint 替换它，这样
    # raw ANSI status lines are routed through prompt_toolkit's renderer
    # 原始 ANSI 状态行会经由 prompt_toolkit 的 renderer 输出，
    # instead of going directly to stdout where patch_stdout's StdoutProxy
    # 而不是直接进入 stdout；如果直接进入 stdout，patch_stdout 的 StdoutProxy
    # would mangle the escape sequences.  None = use builtins.print.
    # 可能会破坏转义序列。None 表示使用 builtins.print。
    agent._print_fn = None
    agent.background_review_callback = None  # Optional sync callback for gateway delivery
    # 用于 gateway 投递的可选同步回调。
    agent.memory_notifications = "on"  # Memory update notifications: "off", "on", "verbose"
    # memory 更新通知："off"、"on"、"verbose"。
    agent.skip_context_files = skip_context_files
    agent.load_soul_identity = load_soul_identity
    agent.pass_session_id = pass_session_id
    agent._credential_pool = credential_pool
    agent.log_prefix_chars = log_prefix_chars
    agent.log_prefix = f"{log_prefix} " if log_prefix else ""
    # Store effective base URL for feature detection (prompt caching, reasoning, etc.)
    # 保存实际生效的 base URL，用于特性检测（prompt caching、reasoning 等）。
    agent.base_url = base_url or ""
    provider_name = provider.strip().lower() if isinstance(provider, str) and provider.strip() else None
    agent.provider = provider_name or ""
    agent.acp_command = acp_command or command
    agent.acp_args = list(acp_args or args or [])
    if api_mode in {"chat_completions", "codex_responses", "anthropic_messages", "bedrock_converse", "codex_app_server"}:
        agent.api_mode = api_mode
    elif agent.provider == "openai-codex":
        agent.api_mode = "codex_responses"
    elif agent.provider in {"xai", "xai-oauth"}:
        agent.api_mode = "codex_responses"
    elif (provider_name is None) and (
        agent._base_url_hostname == "chatgpt.com"
        and "/backend-api/codex" in agent._base_url_lower
    ):
        agent.api_mode = "codex_responses"
        agent.provider = "openai-codex"
    elif (provider_name is None) and agent._base_url_hostname == "api.x.ai":
        agent.api_mode = "codex_responses"
        agent.provider = "xai"
    elif agent.provider == "anthropic" or (provider_name is None and agent._base_url_hostname == "api.anthropic.com"):
        agent.api_mode = "anthropic_messages"
        agent.provider = "anthropic"
    elif agent._base_url_lower.rstrip("/").endswith("/anthropic"):
        # Third-party Anthropic-compatible endpoints (e.g. MiniMax, DashScope)
        # 第三方 Anthropic 兼容端点（例如 MiniMax、DashScope）
        # use a URL convention ending in /anthropic. Auto-detect these so the
        # 使用以 /anthropic 结尾的 URL 约定。自动识别这些端点，以便
        # Anthropic Messages API adapter is used instead of chat completions.
        # 使用 Anthropic Messages API adapter，而不是 chat completions。
        agent.api_mode = "anthropic_messages"
    elif agent.provider == "bedrock" or (
        agent._base_url_hostname.startswith("bedrock-runtime.")
        and base_url_host_matches(agent._base_url_lower, "amazonaws.com")
    ):
        # AWS Bedrock — auto-detect from provider name or base URL
        # AWS Bedrock —— 根据 provider 名称或 base URL 自动检测。
        # (bedrock-runtime.<region>.amazonaws.com).
        # URL 形如 bedrock-runtime.<region>.amazonaws.com。
        agent.api_mode = "bedrock_converse"
    else:
        agent.api_mode = "chat_completions"

    # Eagerly warm the transport cache so import errors surface at init,
    # 提前预热 transport 缓存，让 import 错误在初始化阶段暴露，
    # not mid-conversation.  Also validates the api_mode is registered.
    # 而不是在对话中途暴露。同时验证 api_mode 是否已注册。
    try:
        agent._get_transport()
    except Exception:
        pass  # Non-fatal — transport may not exist for all modes yet
        # 非致命错误 —— 某些模式可能尚未有对应的 transport。

    try:
        from hermes_cli.model_normalize import (
            _AGGREGATOR_PROVIDERS,
            normalize_model_for_provider,
        )

        if agent.provider not in _AGGREGATOR_PROVIDERS:
            agent.model = normalize_model_for_provider(agent.model, agent.provider)
    except Exception:
        pass

    # GPT-5.x models usually require the Responses API path, but some
    # GPT-5.x 模型通常需要走 Responses API 路径，但有些
    # providers have exceptions (for example Copilot's gpt-5-mini still
    # providers 存在例外（例如 Copilot 的 gpt-5-mini 仍然
    # uses chat completions). Also auto-upgrade for direct OpenAI URLs
    # 使用 chat completions）。同时也会为直连 OpenAI URL 自动升级，
    # (api.openai.com) since all newer tool-calling models prefer
    # 即 api.openai.com，因为所有较新的工具调用模型都更偏好
    # Responses there. ACP runtimes are excluded: CopilotACPClient
    # 那里的 Responses API。ACP runtime 会被排除：CopilotACPClient
    # handles its own routing and does not implement the Responses API
    # 会处理自己的路由，并且没有实现 Responses API
    # surface.
    # 表面接口。
    # When api_mode was explicitly provided, respect it — the user
    # 当显式提供 api_mode 时，尊重该设置 —— 用户
    # knows what their endpoint supports (#10473).
    # 知道自己的端点支持什么（#10473）。
    # Exception: Azure OpenAI serves gpt-5.x on /chat/completions and
    # 例外：Azure OpenAI 在 /chat/completions 上提供 gpt-5.x，
    # does NOT support the Responses API — skip the upgrade for Azure
    # 并且不支持 Responses API —— 因此对 Azure 跳过升级，
    # (openai.azure.com), even though it looks OpenAI-compatible.
    # 即使它看起来兼容 OpenAI（openai.azure.com）。
    if (
        api_mode is None
        and agent.api_mode == "chat_completions"
        and agent.provider != "copilot-acp"
        and not str(agent.base_url or "").lower().startswith("acp://copilot")
        and not str(agent.base_url or "").lower().startswith("acp+tcp://")
        and not agent._is_azure_openai_url()
        and (
            agent._is_direct_openai_url()
            or agent._provider_model_requires_responses_api(
                agent.model,
                provider=agent.provider,
            )
        )
    ):
        agent.api_mode = "codex_responses"
        # Invalidate the eager-warmed transport cache — api_mode changed
        # 使提前预热的 transport 缓存失效 —— api_mode 已经
        # from chat_completions to codex_responses after the warm at __init__.
        # 在 __init__ 预热之后从 chat_completions 改成了 codex_responses。
        if hasattr(agent, "_transport_cache"):
            agent._transport_cache.clear()

    # Pre-warm OpenRouter model metadata cache in a background thread.
    # 在后台线程中预热 OpenRouter 模型元数据缓存。
    # fetch_model_metadata() is cached for 1 hour; this avoids a blocking
    # fetch_model_metadata() 会缓存 1 小时；这样可以避免在第一次 API 响应中
    # HTTP request on the first API response when pricing is estimated.
    # 估算价格时发生阻塞式 HTTP 请求。
    # Use a process-level Event so this thread is only spawned once — a new
    # 使用进程级 Event 确保该线程只启动一次 —— gateway 每次请求都会创建新的
    # AIAgent is created for every gateway request, so without the guard
    # AIAgent，因此如果没有这个保护，
    # each message leaks one OS thread and the process eventually exhausts
    # 每条消息都会泄漏一个 OS 线程，最终进程会耗尽
    # the system thread limit (RuntimeError: can't start new thread).
    # 系统线程上限（RuntimeError: can't start new thread）。
    if (agent.provider == "openrouter" or agent._is_openrouter_url()) and \
            not _ra()._openrouter_prewarm_done.is_set():
        _ra()._openrouter_prewarm_done.set()
        threading.Thread(
            target=fetch_model_metadata,
            daemon=True,
            name="openrouter-prewarm",
        ).start()

    agent.tool_progress_callback = tool_progress_callback
    agent.tool_start_callback = tool_start_callback
    agent.tool_complete_callback = tool_complete_callback
    agent.suppress_status_output = False
    agent.thinking_callback = thinking_callback
    agent.reasoning_callback = reasoning_callback
    agent.clarify_callback = clarify_callback
    agent.read_terminal_callback = read_terminal_callback
    agent.step_callback = step_callback
    agent.stream_delta_callback = stream_delta_callback
    agent.interim_assistant_callback = interim_assistant_callback
    agent.status_callback = status_callback
    agent.notice_callback = notice_callback
    agent.notice_clear_callback = notice_clear_callback
    agent.event_callback = event_callback
    agent.tool_gen_callback = tool_gen_callback

    
    # Tool execution state — allows _vprint during tool execution
    # 工具执行状态 —— 允许工具执行期间调用 _vprint，
    # even when stream consumers are registered (no tokens streaming then)
    # 即使已经注册 stream consumer 也可以（那时没有 token 在流式输出）。
    agent._executing_tools = False
    agent._tool_guardrails = ToolCallGuardrailController()
    agent._tool_guardrail_halt_decision: ToolGuardrailDecision | None = None

    # Interrupt mechanism for breaking out of tool loops
    # 用于跳出工具循环的中断机制。
    agent._interrupt_requested = False
    agent._interrupt_message = None  # Optional message that triggered interrupt
    # 触发中断的可选消息。
    agent._execution_thread_id: int | None = None  # Set at run_conversation() start
    # 在 run_conversation() 开始时设置。
    agent._interrupt_thread_signal_pending = False
    agent._client_lock = threading.RLock()

    # /steer mechanism — inject a user note into the next tool result
    # /steer 机制 —— 向下一个工具结果注入用户备注，
    # without interrupting the agent. Unlike interrupt(), steer() does
    # 但不中断 agent。与 interrupt() 不同，steer()
    # NOT set _interrupt_requested; it waits for the current tool batch
    # 不会设置 _interrupt_requested；它会等待当前工具批次
    # to finish naturally, then the drain hook appends the text to the
    # 自然结束，然后 drain hook 会把文本追加到
    # last tool result's content so the model sees it on its next
    # 最后一个工具结果的 content 中，让模型在下一次
    # iteration. Message-role alternation is preserved (we modify an
    # iteration 中看到它。消息 role 交替保持不变（我们修改的是
    # existing tool message rather than inserting a new user turn).
    # 现有 tool 消息，而不是插入新的 user turn）。
    agent._pending_steer: Optional[str] = None
    agent._pending_steer_lock = threading.Lock()

    # Concurrent-tool worker thread tracking.  `_execute_tool_calls_concurrent`
    # 并发工具 worker 线程跟踪。`_execute_tool_calls_concurrent`
    # runs each tool on its own ThreadPoolExecutor worker — those worker
    # 会让每个工具运行在自己的 ThreadPoolExecutor worker 上 —— 这些 worker
    # threads have tids distinct from `_execution_thread_id`, so
    # 线程的 tid 与 `_execution_thread_id` 不同，因此
    # `_set_interrupt(True, _execution_thread_id)` alone does NOT cause
    # 单独调用 `_set_interrupt(True, _execution_thread_id)` 并不会让
    # `is_interrupted()` inside the worker to return True.  Track the
    # worker 内部的 `is_interrupted()` 返回 True。这里跟踪这些
    # workers here so `interrupt()` / `clear_interrupt()` can fan out to
    # worker，使 `interrupt()` / `clear_interrupt()` 可以分发到
    # their tids explicitly.
    # 它们各自的 tid。
    agent._tool_worker_threads: set[int] = set()
    agent._tool_worker_threads_lock = threading.Lock()
    
    # Subagent delegation state
    # 子 agent delegation 状态。
    agent._delegate_depth = 0        # 0 = top-level agent, incremented for children
    # 0 表示顶层 agent，子 agent 会递增该值。
    agent._active_children = []      # Running child AIAgents (for interrupt propagation)
    # 正在运行的子 AIAgent（用于传播中断）。
    agent._active_children_lock = threading.Lock()
    
    # Store OpenRouter provider preferences
    # 保存 OpenRouter provider 偏好。
    agent.providers_allowed = providers_allowed
    agent.providers_ignored = providers_ignored
    agent.providers_order = providers_order
    agent.provider_sort = provider_sort
    agent.provider_require_parameters = provider_require_parameters
    agent.provider_data_collection = provider_data_collection
    agent.openrouter_min_coding_score = openrouter_min_coding_score

    # Store toolset filtering options
    # 保存 toolset 过滤选项。
    agent.enabled_toolsets = enabled_toolsets
    agent.disabled_toolsets = disabled_toolsets
    
    # Model response configuration
    # 模型响应配置。
    agent.max_tokens = max_tokens  # None = use model default
    # None 表示使用模型默认值。
    agent.reasoning_config = reasoning_config  # None = use default (medium for OpenRouter)
    # None 表示使用默认值（OpenRouter 为 medium）。
    agent.service_tier = service_tier
    agent.request_overrides = dict(request_overrides or {})
    agent.prefill_messages = prefill_messages or []  # Prefilled conversation turns
    # 预填充的对话 turn。
    agent._force_ascii_payload = False
    
    # Anthropic prompt caching: auto-enabled for Claude models on native
    # Anthropic prompt caching：在原生 Anthropic、
    # Anthropic, OpenRouter, and third-party gateways that speak the
    # OpenRouter，以及使用
    # Anthropic protocol (``api_mode == 'anthropic_messages'``). Reduces
    # Anthropic 协议的第三方 gateway 上，会为 Claude 模型自动启用（``api_mode == 'anthropic_messages'``）。可减少
    # input costs by ~75% on multi-turn conversations. Uses system_and_3
    # 多轮对话约 75% 的输入成本。使用 system_and_3
    # strategy (4 breakpoints). See ``_anthropic_prompt_cache_policy``
    # 策略（4 个 breakpoint）。关于布局与 transport 的决策，
    # for the layout-vs-transport decision.
    # 请参见 ``_anthropic_prompt_cache_policy``。
    agent._use_prompt_caching, agent._use_native_cache_layout = (
        agent._anthropic_prompt_cache_policy()
    )
    # Anthropic supports "5m" (default) and "1h" cache TTL tiers. Read from
    # Anthropic 支持 "5m"（默认）和 "1h" 两档 cache TTL。从
    # config.yaml under prompt_caching.cache_ttl; unknown values keep "5m".
    # config.yaml 的 prompt_caching.cache_ttl 读取；未知值保持 "5m"。
    # 1h tier costs 2x on write vs 1.25x for 5m, but amortizes across long
    # 1h 档写入成本是 2x，而 5m 是 1.25x，但在
    # sessions with >5-minute pauses between turns (#14971).
    # turn 之间暂停超过 5 分钟的长 session 中可以摊销成本（#14971）。
    agent._cache_ttl = "5m"
    try:
        from hermes_cli.config import load_config as _load_pc_cfg

        _pc_cfg = _load_pc_cfg().get("prompt_caching", {}) or {}
        _ttl = _pc_cfg.get("cache_ttl", "5m")
        if _ttl in {"5m", "1h"}:
            agent._cache_ttl = _ttl
    except Exception:
        pass

    # Iteration budget: the LLM is only notified when it actually exhausts
    # 迭代预算：只有当 LLM 真正耗尽迭代预算时才会通知它，
    # the iteration budget (api_call_count >= max_iterations).  At that
    # 也就是 api_call_count >= max_iterations。到那时，
    # point we inject ONE message, allow one final API call, and if the
    # 我们会注入一条消息，允许最后一次 API 调用；如果
    # model doesn't produce a text response, force a user-message asking
    # 模型没有产出文本响应，就强制追加一条 user-message，
    # it to summarise.  No intermediate pressure warnings — they caused
    # 要求它做总结。中途不再给压力警告 —— 因为它们曾导致
    # models to "give up" prematurely on complex tasks (#7915).
    # 模型在复杂任务中过早“放弃”（#7915）。
    agent._budget_exhausted_injected = False
    agent._budget_grace_call = False

    # Activity tracking — updated on each API call, tool execution, and
    # 活动跟踪 —— 每次 API 调用、工具执行以及
    # stream chunk.  Used by the gateway timeout handler to report what the
    # stream chunk 到达时都会更新。gateway timeout handler 会用它报告
    # agent was doing when it was killed, and by the "still working"
    # agent 被杀掉时正在做什么；"still working"
    # notifications to show progress.
    # 通知也会用它展示进度。
    agent._last_activity_ts: float = time.time()
    agent._last_activity_desc: str = "initializing"
    agent._current_tool: str | None = None
    agent._api_call_count: int = 0
    # Opt-out flag for the between-turns MCP tool refresh (build_turn_context).
    # 用于选择退出 turn 之间 MCP 工具刷新（build_turn_context）的标志。
    # Set on internal forks (e.g. background_review) that must keep ``tools[]``
    # 设置在必须让 ``tools[]`` 与父级保持字节级一致的内部 fork 上
    # byte-identical to a parent for provider cache parity.
    # （例如 background_review），以维持 provider 缓存一致性。
    agent._skip_mcp_refresh = False
    # Registry generation the current tool snapshot was derived from. Lets a
    # 当前工具快照来源的 registry generation。它允许
    # late/concurrent refresh reject a stale (older-generation) rebuild instead
    # 较晚或并发的刷新拒绝陈旧的（更老 generation 的）重建，
    # of clobbering a newer one. Set adjacent to the tool snapshot below.
    # 而不是覆盖更新的结果。它会在下面紧邻工具快照设置。
    agent._tool_snapshot_generation = 0
    # Rate limit tracking — updated from x-ratelimit-* response headers
    # rate limit 跟踪 —— 根据 x-ratelimit-* 响应头更新，
    # after each API call.  Accessed by /usage slash command.
    # 每次 API 调用后更新。由 /usage slash command 读取。
    agent._rate_limit_state: Optional["RateLimitState"] = None

    # Credits tracking (dev-only, L0 usage-aware-credits) — updated from
    # credits 跟踪（仅开发用，L0 usage-aware-credits）—— 根据
    # x-nous-credits-* response headers after each API call.  Session-start
    # 每次 API 调用后的 x-nous-credits-* 响应头更新。session-start
    # remaining is latched the first time a header is ever seen so we can
    # remaining 会在首次看到响应头时锁存，这样我们就能
    # report cumulative micros spent.  Surfaced behind HERMES_DEV_CREDITS.
    # 报告累计消耗的 micros。通过 HERMES_DEV_CREDITS 暴露。
    agent._credits_state = None
    agent._credits_session_start_micros = None
    # Threshold-notice latch (L4): active sticky-notice keys + the warn90 crossing gate.
    # 阈值通知锁存器（L4）：活跃 sticky-notice key + warn90 穿越门。
    agent._credits_latch = {"active": set(), "seen_below_90": False, "usage_band": None}

    # OpenRouter response cache hit counter — incremented when
    # OpenRouter 响应缓存命中计数器 —— 当
    # X-OpenRouter-Cache-Status: HIT is seen in streaming response headers.
    # streaming 响应头中出现 X-OpenRouter-Cache-Status: HIT 时递增。
    agent._or_cache_hits: int = 0

    # Centralized logging — agent.log (INFO+) and errors.log (WARNING+)
    # 集中式日志 —— agent.log（INFO+）和 errors.log（WARNING+）
    # both live under ~/.hermes/logs/.  Idempotent, so gateway mode
    # 都位于 ~/.hermes/logs/。它是幂等的，因此 gateway 模式
    # (which creates a new AIAgent per message) won't duplicate handlers.
    # （每条消息都会创建一个新的 AIAgent）不会重复添加 handler。
    from hermes_logging import setup_logging, setup_verbose_logging
    setup_logging(hermes_home=_ra()._hermes_home)

    if agent.verbose_logging:
        setup_verbose_logging()
        _ra().logger.info("Verbose logging enabled (third-party library logs suppressed)")
    elif agent.quiet_mode:
        # In quiet mode (CLI default), keep console output clean —
        # 在 quiet mode（CLI 默认）下，保持控制台输出干净 ——
        # but DO NOT raise per-logger levels. Doing so prevents the
        # 但不要提高每个 logger 的级别。这样做会阻止
        # root logger's file handlers (agent.log, errors.log) from
        # root logger 的文件 handler（agent.log、errors.log）
        # ever seeing the records, because Python checks
        # 看到这些记录，因为 Python 会在 handler propagation 之前检查
        # logger.isEnabledFor() before handler propagation. We rely
        # logger.isEnabledFor()。我们依赖的事实是：
        # on the fact that hermes_logging.setup_logging() does not
        # hermes_logging.setup_logging() 在 quiet mode 下
        # install a console StreamHandler in quiet mode — so INFO
        # 不会安装 console StreamHandler —— 因此 INFO
        # records flow to the file handlers but never reach a
        # 记录会流向文件 handler，但永远不会到达
        # console. Any future noise reduction belongs at the
        # 控制台。未来任何降噪都应该放在
        # handler level inside hermes_logging.py, not here.
        # hermes_logging.py 内部的 handler 层，而不是这里。
        pass
    
    # Internal stream callback (set during streaming TTS).
    # 内部 stream callback（在 streaming TTS 期间设置）。
    # Initialized here so _vprint can reference it before run_conversation.
    # 在这里初始化，使 _vprint 可以在 run_conversation 之前引用它。
    agent._stream_callback = None
    # Deferred paragraph break flag — set after tool iterations so a
    # 延迟段落换行标志 —— 在工具迭代后设置，这样
    # single "\n\n" is prepended to the next real text delta.
    # 下一个真实文本 delta 前会加上单个 "\n\n"。
    agent._stream_needs_break = False
    # Stateful scrubber for <memory-context> spans split across stream
    # 用于处理跨 stream delta 拆分的 <memory-context> 片段的有状态 scrubber
    # deltas (#5719).  sanitize_context() alone can't survive chunk
    # （#5719）。单靠 sanitize_context() 无法跨 chunk
    # boundaries because the block regex needs both tags in one string.
    # 边界工作，因为 block regex 需要两个标签出现在同一个字符串中。
    agent._stream_context_scrubber = StreamingContextScrubber()
    # Stateful scrubber for reasoning/thinking tags in streamed deltas
    # 用于 streamed delta 中 reasoning/thinking 标签的有状态 scrubber
    # (#17924).  Replaces the per-delta _strip_think_blocks regex that
    # （#17924）。它替代了逐 delta 运行的 _strip_think_blocks 正则，
    # destroyed downstream state (e.g. MiniMax-M2.7 streaming
    # 后者会破坏下游状态（例如 MiniMax-M2.7 streaming
    # '<think>' as delta1 and 'Let me check' as delta2 — the regex
    # 把 '<think>' 作为 delta1、'Let me check' 作为 delta2 —— 该正则
    # erased delta1, so downstream state machines never learned a
    # 会擦掉 delta1，导致下游状态机永远不知道
    # block was open and leaked delta2 as content).
    # 已经打开了一个 block，并把 delta2 泄露为普通内容）。
    agent._stream_think_scrubber = StreamingThinkScrubber()
    # Visible assistant text already delivered through live token callbacks
    # 已经通过 live token callback 投递出去的可见 assistant 文本，
    # during the current model response. Used to avoid re-sending the same
    # 属于当前模型响应。用于避免在 provider 稍后把同一段内容作为
    # commentary when the provider later returns it as a completed interim
    # 已完成的 interim assistant message 返回时，
    # assistant message.
    # 重复发送相同 commentary。
    agent._current_streamed_assistant_text = ""

    # Optional current-turn user-message override used when the API-facing
    # 可选的当前 turn user-message 覆盖值，用于 API-facing
    # user message intentionally differs from the persisted transcript
    # user message 有意不同于持久化 transcript 的情况
    # (e.g. CLI voice mode adds a temporary prefix for the live call only).
    # （例如 CLI voice mode 只为 live call 添加临时前缀）。
    agent._persist_user_message_idx = None
    agent._persist_user_message_override = None
    agent._persist_user_message_timestamp = None

    # Cache anthropic image-to-text fallbacks per image payload/URL so a
    # 按 image payload/URL 缓存 anthropic image-to-text fallback，这样
    # single tool loop does not repeatedly re-run auxiliary vision on the
    # 单个工具循环就不会对同一段 image history
    # same image history.
    # 反复重新运行 auxiliary vision。
    agent._anthropic_image_fallback_cache: Dict[str, str] = {}

    # Initialize LLM client via centralized provider router.
    # 通过集中式 provider router 初始化 LLM client。
    # The router handles auth resolution, base URL, headers, and
    # router 负责处理鉴权解析、base URL、headers，以及
    # Codex/Anthropic wrapping for all known providers.
    # 所有已知 providers 的 Codex/Anthropic wrapping。
    # raw_codex=True because the main agent needs direct responses.stream()
    # raw_codex=True，因为主 agent 需要直接访问 responses.stream()
    # access for Codex Responses API streaming.
    # 以支持 Codex Responses API streaming。
    agent._anthropic_client = None
    agent._is_anthropic_oauth = False

    # Resolve per-provider / per-model request timeout once up front so
    # 提前一次性解析每个 provider / 每个 model 的请求超时，这样
    # every client construction path below (Anthropic native, OpenAI-wire,
    # 下面每条 client 构造路径（Anthropic native、OpenAI-wire、
    # router-based implicit auth) can apply it consistently.  Bedrock
    # 基于 router 的隐式鉴权）都能一致应用它。Bedrock
    # Claude uses its own timeout path and is not covered here.
    # Claude 使用自己的超时路径，不在这里处理。
    _provider_timeout = get_provider_request_timeout(agent.provider, agent.model)

    if agent.api_mode == "anthropic_messages":
        from agent.anthropic_adapter import build_anthropic_client, resolve_anthropic_token
        # Bedrock + Claude → use AnthropicBedrock SDK for full feature parity
        # Bedrock + Claude → 使用 AnthropicBedrock SDK 以获得完整特性一致性
        # (prompt caching, thinking budgets, adaptive thinking).
        # 包括 prompt caching、thinking budgets、adaptive thinking。
        _is_bedrock_anthropic = agent.provider == "bedrock"
        if _is_bedrock_anthropic:
            from agent.anthropic_adapter import build_anthropic_bedrock_client
            _region_match = re.search(r"bedrock-runtime\.([a-z0-9-]+)\.", base_url or "")
            _br_region = _region_match.group(1) if _region_match else "us-east-1"
            agent._bedrock_region = _br_region
            agent._anthropic_client = build_anthropic_bedrock_client(_br_region)
            agent._anthropic_api_key = "aws-sdk"
            agent._anthropic_base_url = base_url
            agent._is_anthropic_oauth = False
            agent.api_key = "aws-sdk"
            agent.client = None
            agent._client_kwargs = {}
            if not agent.quiet_mode:
                print(f"🤖 AI Agent initialized with model: {agent.model} (AWS Bedrock + AnthropicBedrock SDK, {_br_region})")
        else:
            # Only fall back to ANTHROPIC_TOKEN when the provider is actually Anthropic.
            # 只有当 provider 确实是 Anthropic 时才回退到 ANTHROPIC_TOKEN。
            # Other anthropic_messages providers (MiniMax, Alibaba, etc.) must use their own API key.
            # 其他 anthropic_messages providers（MiniMax、Alibaba 等）必须使用自己的 API key。
            # Falling back would send Anthropic credentials to third-party endpoints (Fixes #1739, #minimax-401).
            # 如果回退，会把 Anthropic 凭据发送到第三方端点（修复 #1739、#minimax-401）。
            _is_native_anthropic = agent.provider == "anthropic"
            effective_key = (api_key or resolve_anthropic_token() or "") if _is_native_anthropic else (api_key or "")

            # MiniMax OAuth issues short-lived (~15-min) access tokens. The
            # MiniMax OAuth 会签发短生命周期（约 15 分钟）的 access token。Anthropic
            # Anthropic SDK caches ``api_key`` as a static string at client
            # SDK 会在 client 构造时把 ``api_key`` 缓存为静态字符串，
            # construction time, so a session that resolves the bearer once
            # 因此如果一个 session 只在启动时解析一次 bearer，
            # at startup will keep sending the same token until MiniMax
            # 它就会持续发送同一个 token，直到 MiniMax
            # returns 401 mid-session. Swap the static string for a callable
            # 在 session 中途返回 401。这里把静态字符串替换成 callable
            # token provider — ``build_anthropic_client`` recognizes the
            # token provider —— ``build_anthropic_client`` 会识别这个
            # callable and installs an httpx event hook that mints a fresh
            # callable，并安装一个 httpx event hook，在每次
            # bearer per outbound request (re-reading auth.json so a refresh
            # outbound request 时铸造新的 bearer（重新读取 auth.json，
            # persisted by another process is visible immediately).
            # 因此另一个进程持久化的刷新会立即可见）。
            # The cached refresh path is a no-op when the token still has
            # 当 token 仍剩余
            # ``MINIMAX_OAUTH_REFRESH_SKEW_SECONDS`` of life left, so steady-
            # ``MINIMAX_OAUTH_REFRESH_SKEW_SECONDS`` 生命周期时，缓存刷新路径是 no-op，
            # state cost is one file read + one timestamp compare per request.
            # 因此稳态成本是每个请求一次文件读取 + 一次时间戳比较。
            if agent.provider == "minimax-oauth" and isinstance(effective_key, str) and effective_key:
                try:
                    from hermes_cli.auth import build_minimax_oauth_token_provider
                    effective_key = build_minimax_oauth_token_provider()
                except Exception as _mm_exc:  # noqa: BLE001 — never block startup on this
                    import logging as _logging
                    _logging.getLogger(__name__).warning(
                        "MiniMax OAuth: failed to install per-request token provider "
                        "(%s); falling back to static bearer that will expire ~15min in.",
                        _mm_exc,
                    )

            agent.api_key = effective_key
            agent._anthropic_api_key = effective_key
            agent._anthropic_base_url = base_url
            # Only mark the session as OAuth-authenticated when the token
            # 只有当 token 确实属于原生 Anthropic 时，
            # genuinely belongs to native Anthropic.  Third-party providers
            # 才把 session 标记为 OAuth-authenticated。接受
            # (MiniMax, Kimi, GLM, LiteLLM proxies) that accept the
            # Anthropic 协议的第三方 providers
            # Anthropic protocol must never trip OAuth code paths — doing
            # （MiniMax、Kimi、GLM、LiteLLM proxies）绝不能触发 OAuth code path —— 
            # so injects Claude-Code identity headers and system prompts
            # 否则会注入 Claude-Code identity headers 和 system prompts，
            # that cause 401/403 on their endpoints.  Guards #1739 and
            # 从而导致它们的端点返回 401/403。它防护 #1739 以及
            # the third-party identity-injection bug.
            # 第三方 identity-injection bug。
            from agent.anthropic_adapter import _is_oauth_token as _is_oat
            agent._is_anthropic_oauth = _is_oat(effective_key) if (_is_native_anthropic and isinstance(effective_key, str)) else False
            agent._anthropic_client = build_anthropic_client(effective_key, base_url, timeout=_provider_timeout)
            # No OpenAI client needed for Anthropic mode
            # Anthropic 模式不需要 OpenAI client。
            agent.client = None
            agent._client_kwargs = {}
            if not agent.quiet_mode:
                print(f"🤖 AI Agent initialized with model: {agent.model} (Anthropic native)")
                # ``effective_key`` may be a callable Entra ID bearer
                # ``effective_key`` 可能是一个 callable Entra ID bearer
                # provider for Azure Foundry anthropic_messages mode.
                # provider，用于 Azure Foundry anthropic_messages 模式。
                # The Anthropic adapter installs an httpx event hook
                # Anthropic adapter 会安装一个 httpx event hook，
                # that mints a fresh JWT per request — we never
                # 为每个请求铸造新的 JWT —— 我们绝不会
                # invoke or inspect the callable in the banner.
                # 在 banner 中调用或检查这个 callable。
                from agent.azure_identity_adapter import is_token_provider

                if is_token_provider(effective_key):
                    print("🔑 Using credentials: Microsoft Entra ID")
                elif isinstance(effective_key, str) and len(effective_key) > 12:
                    print(f"🔑 Using token: {effective_key[:8]}...{effective_key[-4:]}")
    elif agent.provider == "moa":
        from agent.moa_loop import MoAClient
        agent.api_mode = "chat_completions"

        # Route reference-model outputs to the agent's tool_progress_callback so
        # 将 reference-model 输出路由到 agent 的 tool_progress_callback，
        # every surface that already consumes it (CLI spinner/scrollback, TUI,
        # 这样每个已经消费该回调的界面（CLI spinner/scrollback、TUI、
        # desktop, gateway) can show each reference's answer as a labelled block
        # desktop、gateway）都能把每个 reference 的答案显示为带标签的块，
        # before the aggregator acts. The facade emits "moa.reference" and
        # 且发生在 aggregator 动作之前。facade 会发出 "moa.reference" 和
        # "moa.aggregating" events; we forward them through the same callback
        # "moa.aggregating" 事件；我们通过工具生命周期使用的同一个
        # the tool lifecycle uses. Best-effort and cache-safe — these are
        # callback 转发它们。它是 best-effort 且 cache-safe 的 —— 这些只是
        # display-only events, they never touch the message history.
        # 仅用于显示的事件，永远不会触碰 message history。
        def _moa_reference_relay(event: str, **kwargs: Any) -> None:
            cb = getattr(agent, "tool_progress_callback", None)
            if cb is None:
                return
            try:
                if event == "moa.reference":
                    label = str(kwargs.get("label") or "")
                    text = str(kwargs.get("text") or "")
                    idx = kwargs.get("index")
                    count = kwargs.get("count")
                    cb(
                        "moa.reference",
                        label,
                        text,
                        None,
                        moa_index=idx,
                        moa_count=count,
                    )
                elif event == "moa.aggregating":
                    cb(
                        "moa.aggregating",
                        str(kwargs.get("aggregator") or ""),
                        None,
                        None,
                        moa_ref_count=kwargs.get("ref_count"),
                    )
            except Exception:
                pass

        agent.client = MoAClient(
            agent.model or "default",
            reference_callback=_moa_reference_relay,
        )
        agent._client_kwargs = {}
        agent.api_key = api_key or "moa-virtual-provider"
        agent.base_url = "moa://local"
        if not agent.quiet_mode:
            print(f"🤖 AI Agent initialized with MoA preset: {agent.model}")
    elif agent.api_mode == "bedrock_converse":
        # AWS Bedrock — uses boto3 directly, no OpenAI client needed.
        # AWS Bedrock —— 直接使用 boto3，不需要 OpenAI client。
        # Region is extracted from the base_url or defaults to us-east-1.
        # region 从 base_url 中提取；如果提取不到，则默认 us-east-1。
        _region_match = re.search(r"bedrock-runtime\.([a-z0-9-]+)\.", base_url or "")
        agent._bedrock_region = _region_match.group(1) if _region_match else "us-east-1"
        # Guardrail config — read from config.yaml at init time.
        # guardrail 配置 —— 在初始化时从 config.yaml 读取。
        agent._bedrock_guardrail_config = None
        try:
            from hermes_cli.config import load_config as _load_br_cfg
            _gr = _load_br_cfg().get("bedrock", {}).get("guardrail", {})
            if _gr.get("guardrail_identifier") and _gr.get("guardrail_version"):
                agent._bedrock_guardrail_config = {
                    "guardrailIdentifier": _gr["guardrail_identifier"],
                    "guardrailVersion": _gr["guardrail_version"],
                }
                if _gr.get("stream_processing_mode"):
                    agent._bedrock_guardrail_config["streamProcessingMode"] = _gr["stream_processing_mode"]
                if _gr.get("trace"):
                    agent._bedrock_guardrail_config["trace"] = _gr["trace"]
        except Exception:
            pass
        agent.client = None
        agent._client_kwargs = {}
        if not agent.quiet_mode:
            _gr_label = " + Guardrails" if agent._bedrock_guardrail_config else ""
            print(f"🤖 AI Agent initialized with model: {agent.model} (AWS Bedrock, {agent._bedrock_region}{_gr_label})")
    else:
        if api_key and base_url:
            # Explicit credentials from CLI/gateway — construct directly.
            # 来自 CLI/gateway 的显式凭据 —— 直接构造 client。
            # The runtime provider resolver already handled auth for us.
            # runtime provider resolver 已经替我们处理了鉴权。
            # Extract query params (e.g. Azure api-version) from base_url
            # 从 base_url 中提取 query params（例如 Azure api-version），
            # and pass via default_query to prevent loss during SDK URL
            # 并通过 default_query 传入，避免 SDK URL
            # joining (httpx drops query string when joining paths).
            # joining 时丢失它们（httpx 在 join path 时会丢弃 query string）。
            _parsed_url = urlparse(base_url)
            if _parsed_url.query:
                _clean_url = urlunparse(_parsed_url._replace(query=""))
                _query_params = {
                    k: v[0] for k, v in parse_qs(_parsed_url.query).items()
                }
                client_kwargs = {
                    "api_key": api_key,
                    "base_url": _clean_url,
                    "default_query": _query_params,
                }
            else:
                client_kwargs = {"api_key": api_key, "base_url": base_url}
            if _provider_timeout is not None:
                client_kwargs["timeout"] = _provider_timeout
            if agent.provider == "copilot-acp":
                client_kwargs["command"] = agent.acp_command
                client_kwargs["args"] = agent.acp_args
            effective_base = base_url
            if base_url_host_matches(effective_base, "openrouter.ai"):
                from agent.auxiliary_client import build_or_headers
                client_kwargs["default_headers"] = build_or_headers()
            elif base_url_host_matches(effective_base, "integrate.api.nvidia.com"):
                from agent.auxiliary_client import build_nvidia_nim_headers
                client_kwargs["default_headers"] = build_nvidia_nim_headers(effective_base)
            elif base_url_host_matches(effective_base, "api.routermint.com"):
                client_kwargs["default_headers"] = _ra()._routermint_headers()
            elif base_url_host_matches(effective_base, "api.githubcopilot.com"):
                from hermes_cli.models import copilot_default_headers

                client_kwargs["default_headers"] = copilot_default_headers()
            elif base_url_host_matches(effective_base, "api.kimi.com"):
                client_kwargs["default_headers"] = {
                    "User-Agent": "claude-code/0.1.0",
                }
            elif base_url_host_matches(effective_base, "portal.qwen.ai"):
                client_kwargs["default_headers"] = _ra()._qwen_portal_headers()
            elif base_url_host_matches(effective_base, "chatgpt.com"):
                from agent.auxiliary_client import _codex_cloudflare_headers
                client_kwargs["default_headers"] = _codex_cloudflare_headers(api_key)
            elif "default_headers" not in client_kwargs:
                # Fall back to profile.default_headers for providers that
                # 对声明了自定义 header 的 providers，
                # declare custom headers (e.g. Kimi User-Agent on non-kimi.com
                # 回退使用 profile.default_headers（例如非 kimi.com
                # endpoints).
                # endpoint 上的 Kimi User-Agent）。
                try:
                    from providers import get_provider_profile as _gpf
                    _ph = _gpf(agent.provider)
                    if _ph and _ph.default_headers:
                        client_kwargs["default_headers"] = dict(_ph.default_headers)
                except Exception:
                    pass
        else:
            # No explicit creds — use the centralized provider router
            # 没有显式凭据 —— 使用集中式 provider router。
            from agent.auxiliary_client import resolve_provider_client
            _routed_client, _ = resolve_provider_client(
                agent.provider or "auto", model=agent.model, raw_codex=True)
            if _routed_client is not None:
                client_kwargs = {
                    "api_key": _routed_client.api_key,
                    "base_url": str(_routed_client.base_url),
                }
                if _provider_timeout is not None:
                    client_kwargs["timeout"] = _provider_timeout
                # Preserve provider-specific headers the router set.  The
                # 保留 router 设置的 provider-specific headers。OpenAI
                # OpenAI SDK stores caller-provided default_headers in
                # SDK 会把调用方提供的 default_headers 存到
                # _custom_headers; older/mocked clients may expose
                # _custom_headers；较老或 mock 的 clients 可能通过
                # _default_headers instead.
                # _default_headers 暴露它们。
                _routed_headers = getattr(_routed_client, "_custom_headers", None)
                if not _routed_headers:
                    _routed_headers = getattr(_routed_client, "default_headers", None)
                if not _routed_headers:
                    _routed_headers = getattr(_routed_client, "_default_headers", None)
                if _routed_headers:
                    client_kwargs["default_headers"] = dict(_routed_headers)
            else:
                # When the user explicitly chose a non-OpenRouter provider
                # 当用户显式选择了非 OpenRouter provider，
                # but no credentials were found, fail fast with a clear
                # 但没有找到凭据时，快速失败并给出清晰
                # message instead of silently routing through OpenRouter.
                # 信息，而不是静默路由到 OpenRouter。
                _explicit = (agent.provider or "").strip().lower()
                if _explicit and _explicit not in {"auto", "openrouter", "custom"}:
                    # Look up the actual env var name from the provider
                    # 从 provider 配置中查找真正的环境变量名 ——
                    # config — some providers use non-standard names
                    # 某些 providers 使用非标准名称
                    # (e.g. alibaba → DASHSCOPE_API_KEY, not ALIBABA_API_KEY).
                    # （例如 alibaba → DASHSCOPE_API_KEY，而不是 ALIBABA_API_KEY）。
                    _env_hint = f"{_explicit.upper()}_API_KEY"
                    try:
                        from hermes_cli.auth import PROVIDER_REGISTRY
                        _pcfg = PROVIDER_REGISTRY.get(_explicit)
                        if _pcfg and _pcfg.api_key_env_vars:
                            _env_hint = _pcfg.api_key_env_vars[0]
                    except Exception:
                        pass
                    # --- Init-time fallback (#17929) ---
                    # --- 初始化时 fallback（#17929）---
                    _fb_entries = []
                    if isinstance(fallback_model, list):
                        _fb_entries = [
                            f for f in fallback_model
                            if isinstance(f, dict) and f.get("provider") and f.get("model")
                        ]
                    elif isinstance(fallback_model, dict) and fallback_model.get("provider") and fallback_model.get("model"):
                        _fb_entries = [fallback_model]
                    _fb_resolved = False
                    for _fb in _fb_entries:
                        _fb_explicit_key = (_fb.get("api_key") or "").strip() or None
                        if not _fb_explicit_key:
                            _fb_key_env = (_fb.get("key_env") or _fb.get("api_key_env") or "").strip()
                            if _fb_key_env:
                                _fb_explicit_key = os.getenv(_fb_key_env, "").strip() or None
                        _fb_client, _fb_model = resolve_provider_client(
                            _fb["provider"], model=_fb["model"], raw_codex=True,
                            explicit_base_url=_fb.get("base_url"),
                            explicit_api_key=_fb_explicit_key,
                        )
                        if _fb_client is not None:
                            agent.provider = _fb["provider"]
                            agent.model = _fb_model or _fb["model"]
                            agent._fallback_activated = True
                            client_kwargs = {
                                "api_key": _fb_client.api_key,
                                "base_url": str(_fb_client.base_url),
                            }
                            if _provider_timeout is not None:
                                client_kwargs["timeout"] = _provider_timeout
                            _fb_headers = getattr(_fb_client, "_custom_headers", None)
                            if not _fb_headers:
                                _fb_headers = getattr(_fb_client, "default_headers", None)
                            if not _fb_headers:
                                _fb_headers = getattr(_fb_client, "_default_headers", None)
                            if _fb_headers:
                                client_kwargs["default_headers"] = dict(_fb_headers)
                            _fb_resolved = True
                            break
                    if not _fb_resolved:
                        raise RuntimeError(
                            f"Provider '{_explicit}' is set in config.yaml but no API key "
                            f"was found. Set the {_env_hint} environment "
                            f"variable, or switch to a different provider with `hermes model`."
                        )
                if not getattr(agent, "_fallback_activated", False):
                    # No provider configured — reject with a clear message.
                    # 没有配置 provider —— 用清晰信息拒绝继续。
                    raise RuntimeError(
                        "No LLM provider configured. Run `hermes model` to "
                        "select a provider, or run `hermes setup` for first-time "
                        "configuration."
                    )
        
        agent._client_kwargs = client_kwargs  # stored for rebuilding after interrupt
        # 保存下来，供中断后重建使用。

        # Enable fine-grained tool streaming for Claude on OpenRouter.
        # 为 OpenRouter 上的 Claude 启用 fine-grained tool streaming。
        # Without this, Anthropic buffers the entire tool call and goes
        # 如果没有它，Anthropic 会缓冲整个工具调用并在 thinking 时
        # silent for minutes while thinking — OpenRouter's upstream proxy
        # 静默数分钟 —— OpenRouter 的上游代理
        # times out during the silence.  The beta header makes Anthropic
        # 会在这段静默期间超时。这个 beta header 会让 Anthropic
        # stream tool call arguments token-by-token, keeping the
        # 逐 token 流式输出工具调用参数，从而保持
        # connection alive.
        # 连接存活。
        _effective_base = str(client_kwargs.get("base_url", "")).lower()
        if base_url_host_matches(_effective_base, "openrouter.ai") and "claude" in (agent.model or "").lower():
            headers = client_kwargs.get("default_headers") or {}
            existing_beta = headers.get("x-anthropic-beta", "")
            _FINE_GRAINED = "fine-grained-tool-streaming-2025-05-14"
            if _FINE_GRAINED not in existing_beta:
                if existing_beta:
                    headers["x-anthropic-beta"] = f"{existing_beta},{_FINE_GRAINED}"
                else:
                    headers["x-anthropic-beta"] = _FINE_GRAINED
                client_kwargs["default_headers"] = headers

        # User-configured request headers (model.default_headers in
        # 用户配置的请求 headers（config.yaml 中的 model.default_headers）
        # config.yaml) override provider/SDK defaults. Lets custom
        # 会覆盖 provider/SDK 默认值。这样自定义
        # OpenAI-compatible endpoints behind a gateway/WAF that rejects the
        # OpenAI-compatible endpoints 即使位于会拒绝
        # OpenAI SDK's identifying headers swap in a plain User-Agent. (#40033)
        # OpenAI SDK 识别 headers 的 gateway/WAF 后，也能换成普通 User-Agent。（#40033）
        # client_kwargs is the same dict object as agent._client_kwargs, so
        # client_kwargs 与 agent._client_kwargs 是同一个 dict 对象，因此
        # this mutation is reflected in the client built just below.
        # 这里的 mutation 会反映到下面即将构建的 client 中。
        agent._apply_user_default_headers()

        agent.api_key = client_kwargs.get("api_key", "")
        agent.base_url = client_kwargs.get("base_url", agent.base_url)
        try:
            from agent.ssl_guard import verify_ca_bundle_with_fallback

            verify_ca_bundle_with_fallback()
            agent.client = agent._create_openai_client(client_kwargs, reason="agent_init", shared=True)
            if not agent.quiet_mode:
                print(f"🤖 AI Agent initialized with model: {agent.model}")
                if base_url:
                    print(f"🔗 Using custom base URL: {base_url}")
                # ``api_key`` may be a callable Entra ID bearer
                # ``api_key`` 可能是 callable Entra ID bearer
                # provider (Azure Foundry). The OpenAI SDK mints a
                # provider（Azure Foundry）。OpenAI SDK 会在内部
                # fresh JWT per request internally — the banner
                # 为每个请求铸造新的 JWT —— banner
                # never invokes or inspects the callable.
                # 永远不会调用或检查这个 callable。
                from agent.azure_identity_adapter import is_token_provider

                key_used = client_kwargs.get("api_key", "none")
                if is_token_provider(key_used):
                    print("🔑 Using credentials: Microsoft Entra ID")
                elif isinstance(key_used, str) and key_used and key_used != "dummy-key" and len(key_used) > 12:
                    print(f"🔑 Using API key: {key_used[:8]}...{key_used[-4:]}")
                else:
                    print("⚠️  Warning: API key appears invalid or missing")
        except Exception as e:
            raise RuntimeError(f"Failed to initialize OpenAI client: {e}")
    
    # Provider fallback chain — ordered list of backup providers tried
    # provider fallback chain —— 按顺序尝试的备用 providers 列表，
    # when the primary is exhausted (rate-limit, overload, connection
    # 用于 primary 耗尽时（rate-limit、overload、connection
    # failure).  Supports both legacy single-dict ``fallback_model`` and
    # failure）。同时支持旧版单 dict 的 ``fallback_model`` 和
    # new list ``fallback_providers`` format.
    # 新版 list 形式的 ``fallback_providers`` 格式。
    if isinstance(fallback_model, list):
        agent._fallback_chain = [
            f for f in fallback_model
            if isinstance(f, dict) and f.get("provider") and f.get("model")
        ]
    elif isinstance(fallback_model, dict) and fallback_model.get("provider") and fallback_model.get("model"):
        agent._fallback_chain = [fallback_model]
    else:
        agent._fallback_chain = []
    agent._fallback_index = 0
    agent._fallback_activated = getattr(agent, "_fallback_activated", False)
    # Legacy attribute kept for backward compat (tests, external callers)
    # 为向后兼容保留的旧属性（tests、外部调用方）。
    agent._fallback_model = agent._fallback_chain[0] if agent._fallback_chain else None
    if agent._fallback_chain and not agent.quiet_mode:
        if len(agent._fallback_chain) == 1:
            fb = agent._fallback_chain[0]
            print(f"🔄 Fallback model: {fb['model']} ({fb['provider']})")
        else:
            print(f"🔄 Fallback chain ({len(agent._fallback_chain)} providers): " +
                  " → ".join(f"{f['model']} ({f['provider']})" for f in agent._fallback_chain))

    # Get available tools with filtering. Capture the registry generation this
    # 获取经过过滤的可用工具。先捕获当前快照来源的 registry generation，
    # snapshot is derived from FIRST, so a later concurrent refresh can tell
    # 这样稍后的并发刷新就能判断
    # whether it holds a newer or staler view (see refresh_agent_mcp_tools).
    # 自己持有的是更新还是更旧的视图（参见 refresh_agent_mcp_tools）。
    try:
        from tools.registry import registry as _snapshot_registry
        agent._tool_snapshot_generation = _snapshot_registry._generation
    except Exception:
        agent._tool_snapshot_generation = 0
    agent.tools = _ra().get_tool_definitions(
        enabled_toolsets=enabled_toolsets,
        disabled_toolsets=disabled_toolsets,
        quiet_mode=agent.quiet_mode,
    )
    
    # Show tool configuration and store valid tool names for validation
    # 展示工具配置，并保存有效工具名用于校验。
    agent.valid_tool_names = set()
    if agent.tools:
        agent.valid_tool_names = {tool["function"]["name"] for tool in agent.tools}
        tool_names = sorted(agent.valid_tool_names)
        if not agent.quiet_mode:
            print(f"🛠️  Loaded {len(agent.tools)} tools: {', '.join(tool_names)}")
            # Show filtering info if applied
            # 如果应用了过滤，则展示过滤信息。
            if enabled_toolsets:
                print(f"   ✅ Enabled toolsets: {', '.join(enabled_toolsets)}")
            if disabled_toolsets:
                print(f"   ❌ Disabled toolsets: {', '.join(disabled_toolsets)}")
    elif not agent.quiet_mode:
        print("🛠️  No tools loaded (all tools filtered out or unavailable)")

    # Kanban worker/orchestrator lifecycle guidance is session-static:
    # Kanban worker/orchestrator 生命周期指导是 session-static 的：
    # the dispatcher decides at spawn time whether this process is a kanban
    # dispatcher 会在 spawn 时决定当前进程是否是 kanban
    # worker (kanban_show tool is present iff HERMES_KANBAN_TASK is set).
    # worker（当且仅当设置 HERMES_KANBAN_TASK 时，kanban_show 工具存在）。
    # Resolving the ~835-token block once here avoids re-running the
    # 在这里一次性解析约 835-token 的 block，可以避免在每次
    # membership test + reference on every system-prompt rebuild
    # system-prompt rebuild 时重复执行 membership test + reference
    # (init + each context compression).
    # （初始化 + 每次 context compression）。
    from agent.prompt_builder import KANBAN_GUIDANCE
    agent._kanban_worker_guidance = (
        KANBAN_GUIDANCE if "kanban_show" in agent.valid_tool_names else ""
    )

    # Check tool requirements
    # 检查工具依赖要求。
    if agent.tools and not agent.quiet_mode:
        requirements = _ra().check_toolset_requirements()
        missing_reqs = [name for name, available in requirements.items() if not available]
        if missing_reqs:
            print(f"⚠️  Some tools may not work due to missing requirements: {missing_reqs}")
    
    # Show trajectory saving status
    # 展示 trajectory 保存状态。
    if agent.save_trajectories and not agent.quiet_mode:
        print("📝 Trajectory saving enabled")
    
    # Show ephemeral system prompt status
    # 展示 ephemeral system prompt 状态。
    if agent.ephemeral_system_prompt and not agent.quiet_mode:
        prompt_preview = agent.ephemeral_system_prompt[:60] + "..." if len(agent.ephemeral_system_prompt) > 60 else agent.ephemeral_system_prompt
        print(f"🔒 Ephemeral system prompt: '{prompt_preview}' (not saved to trajectories)")
    
    # Show prompt caching status
    # 展示 prompt caching 状态。
    if agent._use_prompt_caching and not agent.quiet_mode:
        if agent._use_native_cache_layout and agent.provider == "anthropic":
            source = "native Anthropic"
        elif agent._use_native_cache_layout:
            source = "Anthropic-compatible endpoint"
        else:
            source = "Claude via OpenRouter"
        print(f"💾 Prompt caching: ENABLED ({source}, {agent._cache_ttl} TTL)")
    
    # Session logging setup - auto-save conversation trajectories for debugging
    # session 日志设置 —— 自动保存对话轨迹用于调试。
    agent.session_start = datetime.now()
    if session_id:
        # Use provided session ID (e.g., from CLI)
        # 使用提供的 session ID（例如来自 CLI）。
        agent.session_id = session_id
    else:
        # Generate a new session ID
        # 生成新的 session ID。
        timestamp_str = agent.session_start.strftime("%Y%m%d_%H%M%S")
        short_uuid = uuid.uuid4().hex[:6]
        agent.session_id = f"{timestamp_str}_{short_uuid}"

    # Expose session ID to tools (terminal, execute_code) so agents can
    # 将 session ID 暴露给工具（terminal、execute_code），这样 agents 可以
    # reference their own session for --resume commands, cross-session
    # 在 --resume 命令、跨 session
    # coordination, and logging. Keep the ContextVar and os.environ
    # 协作以及日志中引用自己的 session。保持 ContextVar 与 os.environ
    # fallback synchronized because different tool paths still read both.
    # fallback 同步，因为不同工具路径仍然会读取二者。
    try:
        from gateway.session_context import set_current_session_id

        set_current_session_id(agent.session_id)
    except Exception:
        os.environ["HERMES_SESSION_ID"] = agent.session_id

    # Session logs go into ~/.hermes/sessions/ alongside gateway sessions
    # session 日志会进入 ~/.hermes/sessions/，与 gateway sessions 放在一起。
    hermes_home = get_hermes_home()
    agent.logs_dir = hermes_home / "sessions"
    agent.logs_dir.mkdir(parents=True, exist_ok=True)
    # Per-session JSON snapshot writer (~/.hermes/sessions/session_{sid}.json)
    # 每 session JSON snapshot writer（~/.hermes/sessions/session_{sid}.json）
    # is opt-in via sessions.write_json_snapshots (default False).  state.db
    # 通过 sessions.write_json_snapshots 选择启用（默认 False）。state.db
    # is canonical — the snapshot is only useful for external tooling that
    # 才是 canonical；snapshot 只对直接读取 JSON 文件的
    # reads the JSON files directly.  See run_agent._save_session_log.
    # 外部工具有用。参见 run_agent._save_session_log。
    agent._session_json_enabled = False
    try:
        from hermes_cli.config import load_config as _load_sess_cfg
        _sess_cfg = (_load_sess_cfg().get("sessions") or {})
        agent._session_json_enabled = bool(_sess_cfg.get("write_json_snapshots", False))
    except Exception:
        pass
    # logs_dir is retained unconditionally for request_dump_*.json (debug
    # logs_dir 会无条件保留，用于 request_dump_*.json（debug
    # breadcrumb path written by agent_runtime_helpers.dump_api_request_debug).
    # breadcrumb 路径，由 agent_runtime_helpers.dump_api_request_debug 写入）。
    
    # Track conversation messages for session logging
    # 跟踪对话消息，用于 session logging。
    agent._session_messages: List[Dict[str, Any]] = []
    # Responses encrypted reasoning replay state.  Some OpenAI-compatible
    # Responses encrypted reasoning replay 状态。某些 OpenAI-compatible
    # routes accept GPT-5 Responses requests but later reject replayed
    # routes 会接受 GPT-5 Responses 请求，但之后会拒绝 replayed
    # encrypted reasoning blobs (HTTP 400 ``invalid_encrypted_content``).
    # 加密 reasoning blobs（HTTP 400 ``invalid_encrypted_content``）。
    # When that happens we disable replay for the rest of the session and
    # 发生这种情况时，我们会在 session 剩余期间禁用 replay，
    # fall back to stateless continuity.  See
    # 并回退到 stateless continuity。参见
    # agent/conversation_loop.py's invalid_encrypted_content retry branch.
    # agent/conversation_loop.py 中的 invalid_encrypted_content retry 分支。
    agent._codex_reasoning_replay_enabled = True
    agent._memory_write_origin = "assistant_tool"
    agent._memory_write_context = "foreground"
    
    # Cached system prompt -- built once per session, only rebuilt on compression
    # 缓存的 system prompt —— 每个 session 构建一次，仅在 compression 时重建。
    agent._cached_system_prompt: Optional[str] = None
    
    # Filesystem checkpoint manager (transparent — not a tool)
    # 文件系统 checkpoint manager（透明机制 —— 不是工具）。
    from tools.checkpoint_manager import CheckpointManager
    agent._checkpoint_mgr = CheckpointManager(
        enabled=checkpoints_enabled,
        max_snapshots=checkpoint_max_snapshots,
        max_total_size_mb=checkpoint_max_total_size_mb,
        max_file_size_mb=checkpoint_max_file_size_mb,
    )
    
    # SQLite session store (optional -- provided by CLI or gateway)
    # SQLite session store（可选 —— 由 CLI 或 gateway 提供）。
    agent._session_db = session_db
    agent._parent_session_id = parent_session_id
    agent._last_flushed_db_idx = 0  # tracks DB-write cursor to prevent duplicate writes
    # 跟踪 DB 写入游标，防止重复写入。
    agent._session_db_created = False  # DB row deferred to run_conversation()
    # DB row 延迟到 run_conversation() 中创建。
    # Most agents own their session row and should finalize it on close().
    # 大多数 agents 拥有自己的 session row，并应在 close() 时 finalize 它。
    # Some temporary helper agents (manual compression / session-hygiene /
    # 一些临时 helper agents（manual compression / session-hygiene /
    # background-review forks) rotate or share the session forward to a
    # background-review forks）会把 session 轮转或共享到
    # continuation row that must remain open after the helper is torn down;
    # continuation row，而该 row 必须在 helper 被销毁后继续保持打开；
    # those callers explicitly set this flag to False.
    # 这些调用方会显式把该标志设置为 False。
    agent._end_session_on_close = True
    agent._session_init_model_config = {
        "max_iterations": agent.max_iterations,
        "reasoning_config": reasoning_config,
        "max_tokens": max_tokens,
    }
    
    # In-memory todo list for task planning (one per agent/session)
    # 用于任务规划的内存 todo list（每个 agent/session 一个）。
    from tools.todo_tool import TodoStore
    agent._todo_store = TodoStore()
    
    # Load config once for memory, skills, and compression sections
    # 为 memory、skills 和 compression sections 一次性加载配置。
    try:
        from hermes_cli.config import load_config as _load_agent_config
        _agent_cfg = _load_agent_config()
    except Exception:
        _agent_cfg = {}
    try:
        agent._tool_guardrails = ToolCallGuardrailController(
            ToolCallGuardrailConfig.from_mapping(
                _agent_cfg.get("tool_loop_guardrails", {})
            )
        )
    except Exception as _tlg_err:
        _ra().logger.warning("Tool loop guardrail config ignored: %s", _tlg_err)
    # Cache only the derived auxiliary compression context override that is
    # 只缓存派生出来的 auxiliary compression context override，
    # needed later by the startup feasibility check.  Avoid exposing a
    # 它稍后会被 startup feasibility check 使用。避免在 agent 实例上
    # broad pseudo-public config object on the agent instance.
    # 暴露宽泛的伪 public config 对象。
    agent._aux_compression_context_length_config = None

    # Persistent memory (MEMORY.md + USER.md) -- loaded from disk
    # 持久化 memory（MEMORY.md + USER.md）—— 从磁盘加载。
    agent._memory_store = None
    agent._memory_enabled = False
    agent._user_profile_enabled = False
    agent._memory_nudge_interval = 10
    agent._turns_since_memory = 0
    agent._iters_since_skill = 0
    if not skip_memory:
        try:
            mem_config = _agent_cfg.get("memory", {})
            agent._memory_enabled = mem_config.get("memory_enabled", False)
            agent._user_profile_enabled = mem_config.get("user_profile_enabled", False)
            agent._memory_nudge_interval = int(mem_config.get("nudge_interval", 10))
            if agent._memory_enabled or agent._user_profile_enabled:
                from tools.memory_tool import MemoryStore
                agent._memory_store = MemoryStore(
                    memory_char_limit=mem_config.get("memory_char_limit", 2200),
                    user_char_limit=mem_config.get("user_char_limit", 1375),
                )
                agent._memory_store.load_from_disk()
        except Exception:
            pass  # Memory is optional -- don't break agent init
            # memory 是可选的 —— 不要让它破坏 agent 初始化。
    


    # Memory provider plugin (external — one at a time, alongside built-in)
    # memory provider plugin（外部插件 —— 一次一个，与内置 memory 并存）。
    # Reads memory.provider from config to select which plugin to activate.
    # 从配置中读取 memory.provider，以选择要激活的插件。
    agent._memory_manager = None
    if not skip_memory:
        try:
            _mem_provider_name = mem_config.get("provider", "") if mem_config else ""

            if _mem_provider_name and _mem_provider_name.strip():
                from agent.memory_manager import MemoryManager as _MemoryManager
                from plugins.memory import load_memory_provider as _load_mem
                agent._memory_manager = _MemoryManager()
                _mp = _load_mem(_mem_provider_name)
                if _mp and _mp.is_available():
                    agent._memory_manager.add_provider(_mp)
                if agent._memory_manager.providers:
                    _init_kwargs = {
                        "session_id": agent.session_id,
                        "platform": platform or "cli",
                        "hermes_home": str(get_hermes_home()),
                        "agent_context": "primary",
                    }
                    if _init_kwargs["platform"] == "cli":
                        _init_kwargs["warning_callback"] = agent._emit_warning
                        _init_kwargs["status_callback"] = agent._emit_status
                    # Thread session title for memory provider scoping
                    # 传入 session title，用于 memory provider scoping
                    # (e.g. honcho uses this to derive chat-scoped session keys)
                    # （例如 honcho 用它派生 chat-scoped session keys）。
                    if agent._session_db:
                        try:
                            _st = agent._session_db.get_session_title(agent.session_id)
                            if _st:
                                _init_kwargs["session_title"] = _st
                        except Exception:
                            pass
                    # Thread gateway user identity for per-user memory scoping
                    # 传入 gateway 用户身份，用于 per-user memory scoping。
                    if agent._user_id:
                        _init_kwargs["user_id"] = agent._user_id
                    if agent._user_id_alt:
                        _init_kwargs["user_id_alt"] = agent._user_id_alt
                    if agent._user_name:
                        _init_kwargs["user_name"] = agent._user_name
                    if agent._chat_id:
                        _init_kwargs["chat_id"] = agent._chat_id
                    if agent._chat_name:
                        _init_kwargs["chat_name"] = agent._chat_name
                    if agent._chat_type:
                        _init_kwargs["chat_type"] = agent._chat_type
                    if agent._thread_id:
                        _init_kwargs["thread_id"] = agent._thread_id
                    # Thread gateway session key for stable per-chat Honcho session isolation
                    # 传入 gateway session key，用于稳定的 per-chat Honcho session 隔离。
                    if agent._gateway_session_key:
                        _init_kwargs["gateway_session_key"] = agent._gateway_session_key
                    # Profile identity for per-profile provider scoping
                    # profile 身份，用于 per-profile provider scoping。
                    try:
                        from hermes_cli.profiles import get_active_profile_name
                        _profile = get_active_profile_name()
                        _init_kwargs["agent_identity"] = _profile
                        _init_kwargs["agent_workspace"] = "hermes"
                    except Exception:
                        pass
                    agent._memory_manager.initialize_all(**_init_kwargs)
                    _ra().logger.info("Memory provider '%s' activated", _mem_provider_name)
                else:
                    _ra().logger.debug("Memory provider '%s' not found or not available", _mem_provider_name)
                    agent._memory_manager = None
        except Exception as _mpe:
            _ra().logger.warning("Memory provider plugin init failed: %s", _mpe)
            agent._memory_manager = None

    from agent.memory_manager import inject_memory_provider_tools as _inject_memory_provider_tools
    _inject_memory_provider_tools(agent)

    # Skills config: nudge interval for skill creation reminders
    # skills 配置：skill 创建提醒的 nudge 间隔。
    agent._skill_nudge_interval = 10
    try:
        skills_config = _agent_cfg.get("skills", {})
        agent._skill_nudge_interval = int(skills_config.get("creation_nudge_interval", 10))
    except Exception:
        pass

    # Tool-use enforcement config: "auto" (default — matches hardcoded
    # 工具使用强制配置："auto"（默认 —— 匹配硬编码
    # model list), true (always), false (never), or list of substrings.
    # 模型列表）、true（始终）、false（从不），或 substring 列表。
    _agent_section = _agent_cfg.get("agent", {})
    if not isinstance(_agent_section, dict):
        _agent_section = {}
    agent._tool_use_enforcement = _agent_section.get("tool_use_enforcement", "auto")

    # Intent-ack continuation config: "auto" (default — codex_responses only,
    # intent-ack continuation 配置："auto"（默认 —— 仅 codex_responses，
    # the historical gate), true (all api_modes), false (never), or a list of
    # 即历史 gate）、true（所有 api_modes）、false（从不），或
    # model-name substrings.  Resolved against the active api_mode/model in the
    # model-name substrings 列表。在 conversation loop 的 intent-ack block 中，
    # conversation loop's intent-ack block.
    # 根据当前 api_mode/model 解析。
    agent._intent_ack_continuation = _agent_section.get("intent_ack_continuation", "auto")

    # Universal task-completion guidance toggle.  Default True.  Surfaced
    # 通用 task-completion guidance 开关。默认 True。它作为独立 flag 暴露，
    # as a separate flag from tool_use_enforcement because the guidance
    # 与 tool_use_enforcement 分离，因为该 guidance
    # applies to ALL models, not just the model families enforcement
    # 适用于所有模型，而不仅仅是 enforcement
    # targets.
    # 目标模型家族。
    agent._task_completion_guidance = bool(_agent_section.get("task_completion_guidance", True))

    # Universal parallel-tool-call guidance toggle.  Default True.  Separate
    # 通用 parallel-tool-call guidance 开关。默认 True。它与
    # flag from task_completion_guidance because a user may want one but not
    # task_completion_guidance 分离，因为用户可能只想要其中一个，
    # the other.  Steers the model to batch independent tool calls into a
    # 而不想要另一个。它会引导模型把独立工具调用批处理到
    # single turn; the runtime already executes such batches concurrently.
    # 单个 turn 中；runtime 已经会并发执行这类批次。
    agent._parallel_tool_call_guidance = bool(_agent_section.get("parallel_tool_call_guidance", True))

    # Local Python toolchain probe toggle.  Default True.  When False,
    # 本地 Python toolchain 探测开关。默认 True。当为 False 时，
    # the probe is skipped entirely (no subprocess calls, no system-prompt
    # 会完全跳过探测（没有 subprocess 调用，也没有 system-prompt
    # line).  Useful for users on exotic setups where the probe heuristics
    # 行）。对于探测启发式规则容易产生噪声的特殊环境，
    # are noisy.
    # 这对用户很有用。
    agent._environment_probe = bool(_agent_section.get("environment_probe", True))

    # Per-platform prompt-hint overrides (config.yaml → platform_hints).
    # 每个平台的 prompt-hint 覆盖项（config.yaml → platform_hints）。
    # Lets an enterprise admin append to or replace Hermes' built-in
    # 允许企业管理员为单个 messaging platform 追加或替换 Hermes 内置的
    # platform hint for a single messaging platform (e.g. WhatsApp) without
    # platform hint（例如 WhatsApp），而不会
    # affecting other platforms. Shape:
    # 影响其他平台。形状如下：
    #   platform_hints:
    #   platform_hints:
    #     whatsapp:
    #     whatsapp:
    #       append: "When tabular output would help, invoke the ... skill."
    #       append: "When tabular output would help, invoke the ... skill."
    #     slack:
    #     slack:
    #       replace: "Custom Slack hint that fully replaces the default."
    #       replace: "Custom Slack hint that fully replaces the default."
    # Stored verbatim; resolution happens in agent/system_prompt.py against
    # 原样存储；解析发生在 agent/system_prompt.py 中，
    # the active platform. Invalid shapes are ignored defensively so a bad
    # 并基于当前激活的平台。无效形状会被防御性忽略，
    # config entry can never break prompt assembly.
    # 因此错误配置项永远不会破坏 prompt assembly。
    _platform_hints_cfg = _agent_cfg.get("platform_hints", {})
    if not isinstance(_platform_hints_cfg, dict):
        _platform_hints_cfg = {}
    agent._platform_hint_overrides = _platform_hints_cfg

    # App-level API retry count (wraps each model API call).  Default 3,
    # app 级 API retry 次数（包裹每次模型 API 调用）。默认 3，
    # overridable via agent.api_max_retries in config.yaml.  See #11616.
    # 可通过 config.yaml 中的 agent.api_max_retries 覆盖。参见 #11616。
    try:
        _raw_api_retries = _agent_section.get("api_max_retries", 3)
        _api_retries = int(_raw_api_retries)
        _api_retries = max(_api_retries, 1)  # 1 = no retry (single attempt)
        # 1 表示不重试（单次尝试）。
    except (TypeError, ValueError):
        _api_retries = 3
    agent._api_max_retries = _api_retries

    # Initialize context compressor for automatic context management
    # 初始化 context compressor，用于自动 context 管理。
    # Compresses conversation when approaching model's context limit
    # 当接近模型 context limit 时压缩对话。
    # Configuration via config.yaml (compression section)
    # 通过 config.yaml 的 compression section 配置。
    _compression_cfg = _agent_cfg.get("compression", {})
    if not isinstance(_compression_cfg, dict):
        _compression_cfg = {}
    compression_threshold = float(_compression_cfg.get("threshold", 0.50))
    # Per-model/route compaction-threshold override. Codex gpt-5.5 raises to
    # 每模型/每路由的 compaction-threshold 覆盖值。Codex gpt-5.5 会提高到
    # 85% (the Codex backend caps the window at 272K, so the default 50% would
    # 85%（Codex backend 把窗口限制在 272K，因此默认 50% 会在
    # compact at ~136K — half the usable context). Gated by an opt-out config
    # 约 136K 时压缩 —— 也就是可用 context 的一半）。它受 opt-out 配置
    # flag so the user can fall back to the global threshold; when the override
    # flag 控制，让用户可以回退到全局阈值；当该覆盖
    # fires we stash a one-time notification (replayed on the first turn) that
    # 触发时，我们会暂存一条一次性通知（在第一个 turn replay），
    # tells the user what changed and how to revert.
    # 告诉用户发生了什么变化，以及如何恢复。
    _codex_gpt55_autoraise = str(
        _compression_cfg.get("codex_gpt55_autoraise", True)
    ).lower() in {"true", "1", "yes"}
    agent._compression_threshold_autoraised = None
    try:
        from agent.auxiliary_client import (
            _compression_threshold_for_model as _cthresh_fn,
            _is_codex_gpt55 as _is_codex_gpt55_fn,
        )
        _model_cthresh = _cthresh_fn(
            agent.model,
            agent.provider,
            allow_codex_gpt55_autoraise=_codex_gpt55_autoraise,
        )
        if _model_cthresh is not None:
            _prev_threshold = compression_threshold
            compression_threshold = _model_cthresh
            # Notify only for the Codex gpt-5.5 autoraise (the Arcee Trinity
            # 仅对 Codex gpt-5.5 autoraise 发出通知（Arcee Trinity
            # override is a long-standing silent default). Skip the notice when
            # override 是长期存在的静默默认值）。当用户的全局阈值
            # the user's global threshold already meets/exceeds the raised
            # 已经达到或超过被提高后的
            # value, since nothing actually changed for them.
            # 值时跳过通知，因为对他们来说并没有实际变化。
            if (
                _is_codex_gpt55_fn(agent.model, agent.provider)
                and _model_cthresh > _prev_threshold + 1e-9
            ):
                agent._compression_threshold_autoraised = {
                    "from": _prev_threshold,
                    "to": _model_cthresh,
                }
    except Exception:
        pass
    compression_enabled = str(_compression_cfg.get("enabled", True)).lower() in {"true", "1", "yes"}
    compression_target_ratio = float(_compression_cfg.get("target_ratio", 0.20))
    compression_protect_last = int(_compression_cfg.get("protect_last_n", 20))
    # protect_first_n is the number of non-system messages to protect at
    # protect_first_n 是需要在开头保护的 non-system messages 数量，
    # the head, in addition to the system prompt (which is always
    # 除此之外，system prompt 也会被保护（它总是
    # implicitly protected by the compressor).  Floor at 0 — a value of
    # 被 compressor 隐式保护）。下限为 0 —— 值为
    # 0 means "preserve only the system prompt + summary + tail", which
    # 0 表示“只保留 system prompt + summary + tail”，这是
    # is a legitimate (and common) configuration for long-running
    # 长期运行 rolling-compaction sessions 的一种合法
    # rolling-compaction sessions.
    # 且常见配置。
    compression_protect_first = max(
        0, int(_compression_cfg.get("protect_first_n", 3))
    )
    compression_abort_on_summary_failure = str(
        _compression_cfg.get("abort_on_summary_failure", False)
    ).lower() in {"true", "1", "yes"}
    # In-place compaction: when True, compress_context() rewrites the message
    # in-place compaction：为 True 时，compress_context() 会重写 message
    # list + rebuilds the system prompt WITHOUT rotating the session id (no
    # list 并重建 system prompt，但不会轮转 session id（没有
    # parent_session_id chain, no `name #N` renumber). See #38763 and
    # parent_session_id chain，也没有 `name #N` 重新编号）。参见 #38763 和
    # agent/conversation_compression.py. Consumed by compress_context(), not the
    # agent/conversation_compression.py。它由 compress_context() 消费，而不是
    # compressor, so it rides on the agent.
    # compressor，因此挂在 agent 上。
    compression_in_place = is_truthy_value(
        _compression_cfg.get("in_place"), default=False
    )

    # Read optional explicit context_length override for the auxiliary
    # 读取可选的显式 context_length 覆盖值，用于 auxiliary
    # compression model. Custom endpoints often cannot report this via
    # compression model。自定义端点通常无法通过
    # /models, so the startup feasibility check needs the config hint.
    # /models 报告该值，因此 startup feasibility check 需要这个配置提示。
    try:
        _aux_cfg = cfg_get(_agent_cfg, "auxiliary", "compression", default={})
    except Exception:
        _aux_cfg = {}
    if isinstance(_aux_cfg, dict):
        _aux_context_config = _aux_cfg.get("context_length")
    else:
        _aux_context_config = None
    if _aux_context_config is not None:
        try:
            _aux_context_config = int(_aux_context_config)
        except (TypeError, ValueError):
            _aux_context_config = None
    agent._aux_compression_context_length_config = _aux_context_config

    # Read explicit model output-token override from config when the
    # 当调用方没有直接传入时，
    # caller did not pass one directly.
    # 从配置中读取显式的模型 output-token 覆盖值。
    _model_cfg = _agent_cfg.get("model", {})
    if agent.max_tokens is None and isinstance(_model_cfg, dict):
        _config_max_tokens = _model_cfg.get("max_tokens")
        if _config_max_tokens is not None:
            try:
                if isinstance(_config_max_tokens, bool):
                    raise ValueError
                _parsed_max_tokens = int(_config_max_tokens)
                if _parsed_max_tokens <= 0:
                    raise ValueError
                agent.max_tokens = _parsed_max_tokens
            except (TypeError, ValueError):
                _ra().logger.warning(
                    "Invalid model.max_tokens in config.yaml: %r — "
                    "must be a positive integer (e.g. 4096). "
                    "Falling back to provider default.",
                    _config_max_tokens,
                )
                print(
                    f"\n⚠ Invalid model.max_tokens in config.yaml: {_config_max_tokens!r}\n"
                    f"  Must be a positive integer (e.g. 4096).\n"
                    f"  Falling back to provider default.\n",
                    file=sys.stderr,
                )
    agent._session_init_model_config["max_tokens"] = agent.max_tokens

    # Read explicit context_length override from model config
    # 从 model config 中读取显式 context_length 覆盖值。
    if isinstance(_model_cfg, dict):
        _config_context_length = _model_cfg.get("context_length")
    else:
        _config_context_length = None
    if _config_context_length is not None:
        try:
            _config_context_length = int(_config_context_length)
        except (TypeError, ValueError):
            _ra().logger.warning(
                "Invalid model.context_length in config.yaml: %r — "
                "must be a plain integer (e.g. 256000, not '256K'). "
                "Falling back to auto-detection.",
                _config_context_length,
            )
            print(
                f"\n⚠ Invalid model.context_length in config.yaml: {_config_context_length!r}\n"
                f"  Must be a plain integer (e.g. 256000, not '256K').\n"
                f"  Falling back to auto-detected context window.\n",
                file=sys.stderr,
            )
            _config_context_length = None

    # Resolve custom_providers list once for reuse below (startup
    # 一次性解析 custom_providers 列表，供下面复用（startup
    # context-length override and plugin context-engine init).
    # context-length override 和 plugin context-engine init）。
    try:
        from hermes_cli.config import get_compatible_custom_providers
        _custom_providers = get_compatible_custom_providers(_agent_cfg)
    except Exception:
        _custom_providers = _agent_cfg.get("custom_providers")
        if not isinstance(_custom_providers, list):
            _custom_providers = []

    # Store for reuse by _check_compression_model_feasibility (auxiliary
    # 保存起来供 _check_compression_model_feasibility 复用（auxiliary
    # compression model context-length detection needs the same list).
    # compression model context-length detection 需要同一份列表）。
    agent._custom_providers = _custom_providers
    _merge_custom_provider_extra_body(agent, _custom_providers)

    # Check custom_providers per-model context_length
    # 检查 custom_providers 的每模型 context_length。
    if _config_context_length is None and _custom_providers:
        try:
            from hermes_cli.config import get_custom_provider_context_length
            _cp_ctx_resolved = get_custom_provider_context_length(
                model=agent.model,
                base_url=agent.base_url,
                custom_providers=_custom_providers,
            )
            if _cp_ctx_resolved:
                _config_context_length = int(_cp_ctx_resolved)
        except Exception:
            _cp_ctx_resolved = None

        # Surface a clear warning if the user set a context_length but it
        # 如果用户设置了 context_length，但它
        # wasn't a valid positive int — the helper silently skips those.
        # 不是有效正整数，则显示清晰警告 —— helper 会静默跳过这类值。
        if _config_context_length is None:
            _target = agent.base_url.rstrip("/") if agent.base_url else ""
            for _cp_entry in _custom_providers:
                if not isinstance(_cp_entry, dict):
                    continue
                _cp_url = (_cp_entry.get("base_url") or "").rstrip("/")
                if _target and _cp_url == _target:
                    _cp_models = _cp_entry.get("models", {})
                    if isinstance(_cp_models, dict):
                        _cp_model_cfg = _cp_models.get(agent.model, {})
                        if isinstance(_cp_model_cfg, dict):
                            _cp_ctx = _cp_model_cfg.get("context_length")
                            if _cp_ctx is not None:
                                try:
                                    _parsed = int(_cp_ctx)
                                    if _parsed <= 0:
                                        raise ValueError
                                except (TypeError, ValueError):
                                    _ra().logger.warning(
                                        "Invalid context_length for model %r in "
                                        "custom_providers: %r — must be a positive "
                                        "integer (e.g. 256000, not '256K'). "
                                        "Falling back to auto-detection.",
                                        agent.model, _cp_ctx,
                                    )
                                    print(
                                        f"\n⚠ Invalid context_length for model {agent.model!r} in custom_providers: {_cp_ctx!r}\n"
                                        f"  Must be a positive integer (e.g. 256000, not '256K').\n"
                                        f"  Falling back to auto-detected context window.\n",
                                        file=sys.stderr,
                                    )
                    break

    # Persist for reuse on switch_model / fallback activation. Must come
    # 持久保存供 switch_model / fallback activation 复用。必须位于
    # AFTER the custom_providers branch so per-model overrides aren't lost.
    # custom_providers 分支之后，以免丢失 per-model 覆盖值。
    agent._config_context_length = _config_context_length

    agent._ensure_lmstudio_runtime_loaded(_config_context_length)



    # Select context engine: config-driven (like memory providers).
    # 选择 context engine：由配置驱动（类似 memory providers）。
    # 1. Check config.yaml context.engine setting
    # 1. 检查 config.yaml 的 context.engine 设置。
    # 2. Check plugins/context_engine/<name>/ directory (repo-shipped)
    # 2. 检查 plugins/context_engine/<name>/ 目录（仓库内置）。
    # 3. Check general plugin system (user-installed plugins)
    # 3. 检查通用插件系统（用户安装的 plugins）。
    # 4. Fall back to built-in ContextCompressor
    # 4. 回退到内置 ContextCompressor。
    _selected_engine = None
    _copy_failed = False
    _engine_name = "compressor"  # default
    # 默认值。
    try:
        _ctx_cfg = _agent_cfg.get("context", {}) if isinstance(_agent_cfg, dict) else {}
        _engine_name = _ctx_cfg.get("engine", "compressor") or "compressor"
    except Exception:
        pass

    if _engine_name != "compressor":
        # Try loading from plugins/context_engine/<name>/
        # 尝试从 plugins/context_engine/<name>/ 加载。
        try:
            from plugins.context_engine import load_context_engine
            _selected_engine = load_context_engine(_engine_name)
        except Exception as _ce_load_err:
            _ra().logger.debug("Context engine load from plugins/context_engine/: %s", _ce_load_err)

        # Try general plugin system as fallback
        # 回退尝试通用插件系统。
        if _selected_engine is None:
            _candidate = None
            try:
                from hermes_cli.plugins import get_plugin_context_engine
                _candidate = get_plugin_context_engine()
            except Exception:
                _candidate = None
            if _candidate is not None and _candidate.name == _engine_name:
                # Deep-copy the shared plugin singleton so a child agent's
                # 深拷贝共享的 plugin singleton，这样子 agent 的
                # update_model() can't mutate the parent's compressor (#42449).
                # update_model() 就不会修改父 agent 的 compressor（#42449）。
                # Copy can fail for engines holding uncopyable state (locks, DB
                # 对持有不可拷贝状态（locks、DB
                # connections, clients); in that case fall back to the built-in
                # connections、clients）的 engines，copy 可能失败；这种情况下回退到内置
                # compressor with an ACCURATE message rather than silently
                # compressor，并给出准确消息，而不是静默地
                # mislabelling it "not found".
                # 将它误标为 "not found"。
                import copy
                try:
                    _selected_engine = copy.deepcopy(_candidate)
                except Exception as _copy_err:
                    _copy_failed = True
                    _ra().logger.warning(
                        "Context engine '%s' could not be safely copied for this "
                        "agent (%s) — falling back to built-in compressor. Plugin "
                        "engines that hold uncopyable state (locks, DB connections) "
                        "should implement __deepcopy__ to copy only mutable budget "
                        "state.",
                        _engine_name, _copy_err,
                    )
                    _selected_engine = None

        if _selected_engine is None and not _copy_failed:
            _ra().logger.warning(
                "Context engine '%s' not found — falling back to built-in compressor",
                _engine_name,
            )
    # else: config says "compressor" — use built-in, don't auto-activate plugins
    # else：配置指定 "compressor" —— 使用内置实现，不自动激活 plugins。

    if _selected_engine is not None:
        agent.context_compressor = _selected_engine
        # Resolve context_length for plugin engines — mirrors switch_model() path
        # 为 plugin engines 解析 context_length —— 与 switch_model() 路径保持一致。
        from agent.model_metadata import get_model_context_length
        _plugin_ctx_len = get_model_context_length(
            agent.model,
            base_url=agent.base_url,
            api_key=getattr(agent, "api_key", ""),
            config_context_length=_config_context_length,
            provider=agent.provider,
            custom_providers=_custom_providers,
        )
        agent.context_compressor.update_model(
            model=agent.model,
            context_length=_plugin_ctx_len,
            base_url=agent.base_url,
            api_key=getattr(agent, "api_key", ""),
            provider=agent.provider,
            api_mode=agent.api_mode,
        )
        if not agent.quiet_mode:
            _ra().logger.info("Using context engine: %s", _selected_engine.name)
    else:
        agent.context_compressor = ContextCompressor(
            model=agent.model,
            threshold_percent=compression_threshold,
            protect_first_n=compression_protect_first,
            protect_last_n=compression_protect_last,
            summary_target_ratio=compression_target_ratio,
            summary_model_override=None,
            quiet_mode=agent.quiet_mode,
            base_url=agent.base_url,
            api_key=getattr(agent, "api_key", ""),
            config_context_length=_config_context_length,
            provider=agent.provider,
            api_mode=agent.api_mode,
            abort_on_summary_failure=compression_abort_on_summary_failure,
            max_tokens=agent.max_tokens,
        )
    agent.compression_enabled = compression_enabled
    agent.compression_in_place = compression_in_place

    # Reject models whose context window is below the minimum required
    # 拒绝 context window 低于最低要求的模型，
    # for reliable tool-calling workflows (64K tokens).
    # 该最低要求用于可靠的工具调用工作流（64K tokens）。
    _ctx = getattr(agent.context_compressor, "context_length", 0)
    if _ctx and _ctx < MINIMUM_CONTEXT_LENGTH:
        raise ValueError(
            f"Model {agent.model} has a context window of {_ctx:,} tokens, "
            f"which is below the minimum {MINIMUM_CONTEXT_LENGTH:,} required "
            f"by Hermes Agent.  Choose a model with at least "
            f"{MINIMUM_CONTEXT_LENGTH // 1000}K context.  If your server "
            f"reports a window smaller than the model's true window, set "
            f"model.context_length in config.yaml to the real value "
            f"(this must be at least {MINIMUM_CONTEXT_LENGTH // 1000}K)."
        )

    # Inject context engine tool schemas (e.g. lcm_grep, lcm_describe, lcm_expand).
    # 注入 context engine tool schemas（例如 lcm_grep、lcm_describe、lcm_expand）。
    # Skip names that are already present — the _ra().get_tool_definitions()
    # 跳过已经存在的名字 —— 在 #17335 之前，_ra().get_tool_definitions()
    # quiet_mode cache returned a shared list pre-#17335, so a stray
    # 的 quiet_mode cache 会返回共享 list，因此这里一次意外的
    # mutation here would poison subsequent agent inits in the same
    # mutation 会污染同一个 Gateway 进程中后续的 agent 初始化，
    # Gateway process and trip provider-side 'duplicate tool name'
    # 并触发 provider 端的 'duplicate tool name'
    # errors. Even with the cache fix, dedup is the right defense
    # 错误。即使已经修复 cache，去重仍然是正确防御，
    # against plugin paths that may register the same schemas via
    # 用来防止某些 plugin path 通过
    # ctx.register_tool(). Mirrors the memory tools dedup above.
    # ctx.register_tool() 注册相同 schemas。它与上面的 memory tools 去重逻辑一致。
    #
    # Respect the platform's enabled_toolsets configuration (#5544):
    # 尊重平台的 enabled_toolsets 配置（#5544）：
    # context engine tools follow the same gating pattern as memory
    # context engine tools 遵循与 memory
    # provider tools — without the gate, `platform_toolsets: telegram: []`
    # provider tools 相同的 gate 模式 —— 如果没有这个 gate，`platform_toolsets: telegram: []`
    # would still leak lcm_* tools into the tool surface and incur the
    # 仍然会让 lcm_* tools 泄漏到工具表面，并导致
    # same local-model latency penalty.
    # 相同的本地模型延迟惩罚。
    agent._context_engine_tool_names: set = set()
    if (
        hasattr(agent, "context_compressor")
        and agent.context_compressor
        and agent.tools is not None
        and (
            agent.enabled_toolsets is None
            or "context_engine" in agent.enabled_toolsets
        )
    ):
        _existing_tool_names = {
            t.get("function", {}).get("name")
            for t in agent.tools
            if isinstance(t, dict)
        }
        from agent.memory_manager import normalize_tool_schema as _normalize_tool_schema
        for _raw_schema in agent.context_compressor.get_tool_schemas():
            _schema = _normalize_tool_schema(_raw_schema)
            if _schema is None:
                # A schema with no resolvable name (e.g. an already-wrapped
                # 没有可解析 name 的 schema（例如已经 wrapped 的
                # entry) would append a nameless tool that strict providers
                # entry）会追加一个无名工具，严格 providers
                # 400 on, disabling the whole toolset (#47707). Skip it.
                # 会对其返回 400，从而禁用整个 toolset（#47707）。跳过它。
                _ra().logger.warning(
                    "Context engine returned a tool schema with no resolvable "
                    "name; skipping to avoid poisoning the request (%r)",
                    _raw_schema,
                )
                continue
            _tname = _schema["name"]
            if _tname in _existing_tool_names:
                continue  # already registered via plugin/cache path
                # 已经通过 plugin/cache 路径注册。
            _wrapped = {"type": "function", "function": _schema}
            agent.tools.append(_wrapped)
            agent.valid_tool_names.add(_tname)
            agent._context_engine_tool_names.add(_tname)
            _existing_tool_names.add(_tname)

    # Notify context engine of session start
    # 通知 context engine session 已开始。
    if hasattr(agent, "context_compressor") and agent.context_compressor:
        try:
            agent.context_compressor.on_session_start(
                agent.session_id,
                hermes_home=str(get_hermes_home()),
                platform=agent.platform or "cli",
                model=agent.model,
                context_length=getattr(agent.context_compressor, "context_length", 0),
                conversation_id=getattr(agent, "_gateway_session_key", None),
            )
        except Exception as _ce_err:
            _ra().logger.debug("Context engine on_session_start: %s", _ce_err)

    agent._subdirectory_hints = SubdirectoryHintTracker(
        working_dir=os.getenv("TERMINAL_CWD") or None,
    )
    agent._user_turn_count = 0

    # Cumulative token usage for the session
    # session 的累计 token 使用量。
    agent.session_prompt_tokens = 0
    agent.session_completion_tokens = 0
    agent.session_total_tokens = 0
    agent.session_api_calls = 0
    agent.session_input_tokens = 0
    agent.session_output_tokens = 0
    agent.session_cache_read_tokens = 0
    agent.session_cache_write_tokens = 0
    agent.session_reasoning_tokens = 0
    agent.session_estimated_cost_usd = 0.0
    agent.session_cost_status = "unknown"
    agent.session_cost_source = "none"
    
    # ── Ollama num_ctx injection ──
    # ── Ollama num_ctx 注入 ──
    # Ollama defaults to 2048 context regardless of the model's capabilities.
    # 不管模型能力如何，Ollama 默认 context 都是 2048。
    # When running against an Ollama server, detect the model's max context
    # 当运行在 Ollama server 上时，检测模型最大 context，
    # and pass num_ctx on every chat request so the full window is used.
    # 并在每次 chat request 中传入 num_ctx，以使用完整窗口。
    # User override: set model.ollama_num_ctx in config.yaml to cap VRAM use.
    # 用户覆盖：在 config.yaml 中设置 model.ollama_num_ctx 以限制 VRAM 使用。
    # If model.context_length is set, it caps num_ctx so the user's VRAM
    # 如果设置了 model.context_length，它会限制 num_ctx，使用户的 VRAM
    # budget is respected even when GGUF metadata advertises a larger window.
    # 预算得到尊重，即使 GGUF metadata 声称窗口更大。
    agent._ollama_num_ctx: int | None = None
    _ollama_num_ctx_override = None
    if isinstance(_model_cfg, dict):
        _ollama_num_ctx_override = _model_cfg.get("ollama_num_ctx")
    if _ollama_num_ctx_override is not None:
        try:
            agent._ollama_num_ctx = int(_ollama_num_ctx_override)
        except (TypeError, ValueError):
            _ra().logger.debug("Invalid ollama_num_ctx config value: %r", _ollama_num_ctx_override)
    if agent._ollama_num_ctx is None and agent.base_url and is_local_endpoint(agent.base_url):
        try:
            # ``agent.api_key`` may be a callable (Entra token provider).
            # ``agent.api_key`` 可能是 callable（Entra token provider）。
            # Ollama detection makes a manual HTTP request and expects a
            # Ollama detection 会发起手动 HTTP 请求，并期望
            # string — Azure Foundry isn't a local endpoint so this branch
            # 得到字符串 —— Azure Foundry 不是 local endpoint，因此这个分支
            # never fires for Entra, but guard defensively.
            # 永远不会为 Entra 触发，但这里仍然做防御性保护。
            _key_for_ollama = agent.api_key if isinstance(agent.api_key, str) else ""
            _detected = query_ollama_num_ctx(agent.model, agent.base_url, api_key=_key_for_ollama or "")
            if _detected and _detected > 0:
                agent._ollama_num_ctx = _detected
        except Exception as exc:
            _ra().logger.debug("Ollama num_ctx detection failed: %s", exc)
    # Cap auto-detected ollama_num_ctx to the user's explicit context_length.
    # 将自动检测到的 ollama_num_ctx 限制到用户显式设置的 context_length。
    # Without this, GGUF metadata can advertise 256K+ which Ollama honours
    # 如果没有这个限制，GGUF metadata 可能宣称 256K+，而 Ollama 会接受它，
    # by allocating that much VRAM — blowing up small GPUs even though the
    # 并分配那么多 VRAM —— 即使用户已经在 config.yaml 中
    # user explicitly set a smaller context_length in config.yaml.
    # 显式设置了更小的 context_length，小显卡也会因此爆掉。
    if (
        agent._ollama_num_ctx
        and _config_context_length
        and _ollama_num_ctx_override is None  # don't override explicit ollama_num_ctx
        # 不覆盖显式设置的 ollama_num_ctx。
        and agent._ollama_num_ctx > _config_context_length
    ):
        _ra().logger.info(
            "Ollama num_ctx capped: %d -> %d (model.context_length override)",
            agent._ollama_num_ctx, _config_context_length,
        )
        agent._ollama_num_ctx = _config_context_length
    if agent._ollama_num_ctx and not agent.quiet_mode:
        _ra().logger.info(
            "Ollama num_ctx: will request %d tokens (model max from /api/show)",
            agent._ollama_num_ctx,
        )

    if not agent.quiet_mode:
        if compression_enabled:
            print(f"📊 Context limit: {agent.context_compressor.context_length:,} tokens (compress at {int(compression_threshold*100)}% = {agent.context_compressor.threshold_tokens:,})")
        else:
            print(f"📊 Context limit: {agent.context_compressor.context_length:,} tokens (auto-compression disabled)")
        # One-time notice when the Codex gpt-5.5 autoraise kicked in, with the
        # 当 Codex gpt-5.5 autoraise 生效时显示一次性通知，并包含
        # exact opt-back-out command. Printed inline at startup for CLI users;
        # 精确的 opt-back-out 命令。对 CLI 用户，它会在启动时内联打印；
        # gateway users get the same text replayed via _compression_warning on
        # gateway 用户会在 turn 1 通过 _compression_warning replay
        # turn 1 (set below, after the warning slot is initialized).
        # 同一段文本（在下面 warning slot 初始化后设置）。
        _autoraise = getattr(agent, "_compression_threshold_autoraised", None)
        if _autoraise and compression_enabled:
            print(_build_codex_gpt55_autoraise_notice(_autoraise))

    # Check immediately so CLI users see the warning at startup.
    # 立即检查，让 CLI 用户能在启动时看到警告。
    # Gateway status_callback is not yet wired, so any warning is stored
    # gateway status_callback 此时尚未接线，因此任何警告都会存储在
    # in _compression_warning and replayed in the first run_conversation().
    # _compression_warning 中，并在第一次 run_conversation() 中 replay。
    agent._compression_warning = None
    # Gateway parity for the Codex gpt-5.5 autoraise notice: the startup print
    # Codex gpt-5.5 autoraise notice 的 gateway parity：上面的 startup print
    # above only reaches the CLI, so stash the same text here to be replayed
    # 只会到达 CLI，因此这里暂存同样文本，以便
    # through status_callback on the first turn (Telegram/Discord/Slack/etc.).
    # 在第一个 turn 通过 status_callback replay（Telegram/Discord/Slack 等）。
    _autoraise = getattr(agent, "_compression_threshold_autoraised", None)
    if _autoraise and compression_enabled:
        agent._compression_warning = _build_codex_gpt55_autoraise_notice(_autoraise)
    # Lazy feasibility check: deferred to the first turn that approaches the
    # lazy feasibility check：延迟到第一次接近
    # compression threshold. Running it eagerly here costs ~400ms cold (network
    # compression threshold 的 turn。若在这里急切运行，冷启动会花费约 400ms（auxiliary
    # probe of the auxiliary provider chain + /models lookup) on every agent
    # provider chain 的网络探测 + /models lookup），而且每次 agent
    # init, including short ``chat -q`` runs that never reach the threshold.
    # init 都会付出该成本，包括永远达不到阈值的短 ``chat -q`` 运行。
    # ``ensure_compression_feasibility_checked`` (called from
    # ``ensure_compression_feasibility_checked``（由
    # ``run_conversation``'s preflight) runs it at most once per agent.
    # ``run_conversation`` 的 preflight 调用）每个 agent 最多运行一次。
    agent._compression_feasibility_checked = False

    # Snapshot primary runtime for per-turn restoration.  When fallback
    # 为每个 turn 的恢复快照 primary runtime。当 fallback
    # activates during a turn, the next turn restores these values so the
    # 在某个 turn 中激活时，下一个 turn 会恢复这些值，
    # preferred model gets a fresh attempt each time.  Uses a single dict
    # 让首选模型每次都有新的尝试机会。这里使用单个 dict，
    # so new state fields are easy to add without N individual attributes.
    # 因此新增状态字段时不需要添加 N 个独立属性。
    _cc = agent.context_compressor
    agent._primary_runtime = {
        "model": agent.model,
        "provider": agent.provider,
        "base_url": agent.base_url,
        "api_mode": agent.api_mode,
        "api_key": getattr(agent, "api_key", ""),
        "client_kwargs": dict(agent._client_kwargs),
        "use_prompt_caching": agent._use_prompt_caching,
        "use_native_cache_layout": agent._use_native_cache_layout,
        # Context engine state that _try_activate_fallback() overwrites.
        # _try_activate_fallback() 会覆盖的 context engine 状态。
        # Use getattr for model/base_url/api_key/provider since plugin
        # 对 model/base_url/api_key/provider 使用 getattr，因为 plugin
        # engines may not have these (they're ContextCompressor-specific).
        # engines 可能没有这些字段（它们是 ContextCompressor-specific 的）。
        "compressor_model": getattr(_cc, "model", agent.model),
        "compressor_base_url": getattr(_cc, "base_url", agent.base_url),
        "compressor_api_key": getattr(_cc, "api_key", ""),
        "compressor_provider": getattr(_cc, "provider", agent.provider),
        "compressor_context_length": _cc.context_length,
        "compressor_threshold_tokens": _cc.threshold_tokens,
    }
    if agent.api_mode == "anthropic_messages":
        agent._primary_runtime.update({
            "anthropic_api_key": agent._anthropic_api_key,
            "anthropic_base_url": agent._anthropic_base_url,
            "is_anthropic_oauth": agent._is_anthropic_oauth,
        })



__all__ = ["init_agent"]
