# ToolCallGuardrailController

> 记录时间：2026-07-02
> 相关文件：`agent/tool_guardrails.py`, `agent/tool_executor.py`, `run_agent.py`, `agent/turn_context.py`, `tests/agent/test_tool_guardrails.py`, `tests/run_agent/test_tool_call_guardrail_runtime.py`

---

## 一句话概述

用轻量防护栏阻止工具调用原地打转。

---

## 面试官可能会问

1. Agent 如果一直重复调用同一个失败工具，你怎么防止它卡死？
2. 你怎么区分“合理重试”和“无意义重复”？
3. 为什么默认只警告，而不是直接阻断工具调用？

---

## 背景：为什么要做这个？

我们当时遇到的问题是：工具调用让 agent 有了行动能力，但也带来一个很现实的风险。如果模型误判了错误原因，它可能反复调用同一个工具、传同一组参数、拿到同一个失败结果，然后继续重试。更隐蔽的是，读文件、搜索、浏览器快照这类只读工具即使不失败，也可能连续返回同样内容，模型却还在原地绕圈。

这个问题不能只靠 `max_iterations` 解决。`max_iterations` 是最后的总闸，等它触发时，用户已经等了很久，token 和时间也浪费了。我们需要一个更靠近工具层的机制：发现“这不像探索，像循环”时，先提醒模型换策略；如果用户显式开启硬停止，再在下一次重复调用前拦住它。

**关键约束：**
- 不能误伤正常探索：很多工具失败一次后，换参数继续试是合理的。
- 不能破坏写操作：对 `write_file`、`patch`、`terminal` 这类可能有副作用的工具，不能因为输出相同就草率判定“无进展”。
- 不能泄露参数：重复检测需要识别“同一个调用”，但 metadata 里不应该暴露原始参数或 secret。
- 不能让防护栏自己变成复杂副作用中心：它最好只判断，不直接执行、打印或改消息。

---

## 核心设计思想

核心思路很简单：我们把工具循环分成三类信号来判断。

第一类是“同一个工具 + 同一组参数”连续失败，这通常说明模型没有吸收错误。第二类是“同一个工具”虽然参数变化了，但一直失败，这说明这个工具路径可能整体走不通。第三类是幂等工具连续成功但返回同样结果，比如反复读同一个文件，这不是错误，但也没有新信息。

最值得讲的是它的克制：默认只把 warning 追加到 tool result 里，让模型自己恢复；只有配置里打开 `hard_stop_enabled` 后，才会在阈值达到后阻断下一次重复调用或结束当前 turn。

**核心 trade-off：**

| 方案 | 优点 | 缺点 | 我们选了 |
|------|------|------|---------|
| 只依赖 `max_iterations` | 实现简单，不会误判单个工具 | 发现太晚，浪费时间和 token，用户体验差 | |
| 每次重复就直接阻断 | 卡死风险最低 | 很容易误伤正常调试和探索，尤其是终端/搜索场景 | |
| 默认 warning，hard stop 显式开启 | 保留模型恢复空间，同时给需要强保护的场景断路器 | 配置和状态判断稍复杂 | ✓ |

**为什么选这条路：**
1. Hermes 的工具层是核心能力，不能因为防循环就让 agent 不敢用工具。warning-first 更适合交互式 CLI/TUI。
2. 硬停止是有价值的，但应该由配置打开；这样自动化环境可以更强保护，日常交互仍然保留弹性。
3. 幂等判断只覆盖明确只读工具，写工具和未知工具默认不做“同结果无进展”阻断，避免副作用判断出错。

---

## 工程落地

`ToolCallGuardrailController` 做得很干净：它是 per-turn 的纯判断器，只维护本轮观察到的计数和 hash，返回 `allow / warn / block / halt` 决策。真正的副作用交给运行时：warning 追加到 tool result，block 合成一个 tool message，halt 生成最终回答并退出本轮。

**整体架构：**
```
LLM tool_calls
    ↓
before_call：是否已达到硬停止阈值
    ↓ allow / block
真实工具执行
    ↓
after_call：记录失败、同结果、同工具失败
    ↓ warn / halt
把提示附回 tool result，或控制本轮结束
```

**关键代码路径：**
- `agent/tool_guardrails.py` — 定义配置、签名、决策、重复检测和提示生成。
- `agent/tool_executor.py` — 在顺序/并发执行路径里调用 `before_call` 和 `after_call`。
- `run_agent.py` — 把 warning 附到工具结果，把 block 转成合成结果，把 halt 转成用户可见回答。
- `agent/turn_context.py` — 每个用户 turn 开始时 reset guardrail 状态。
- `tests/agent/test_tool_guardrails.py` — 覆盖纯逻辑边界。
- `tests/run_agent/test_tool_call_guardrail_runtime.py` — 覆盖真实运行时接入。

**核心数据结构：**
```
ToolCallSignature = tool_name + sha256(canonical_args)
ToolGuardrailDecision = action + code + message + count
ToolCallGuardrailController = exact_failure + same_tool_failure + no_progress
```

**生命周期：**
1. 初始化时从 `config.yaml` 的 `tool_loop_guardrails` 读取阈值；默认 warning 开启，hard stop 关闭。
2. 每个 turn 开始时清空本轮计数，避免上一轮的失败污染下一轮。
3. 工具执行前先问 `before_call`：如果 hard stop 已启用且阈值达到了，就不再真实执行。
4. 工具执行后调用 `after_call`：失败就累计失败计数；成功则清掉失败 streak，并只对幂等工具检查“同结果无进展”。
5. 如果产生 warning，就把恢复建议追加到 tool result，模型下一轮能读到并换策略。
6. 如果产生 block/halt，就记录 `_tool_guardrail_halt_decision`，conversation loop 返回可解释的停止信息。

---

## 优点

- [ ] **优点1：把卡死问题前移到工具层。** 它不等整个 agent 跑满 `max_iterations`，而是在工具结果刚出现重复模式时就提醒模型换策略。

- [ ] **优点2：默认温和，必要时强制。** 默认 warning 不阻断执行，保留调试空间；hard stop 显式开启后才作为断路器，适合自动化或无人值守场景。

- [ ] **优点3：幂等和副作用边界清楚。** 只读工具可以用“相同结果”判断无进展；写工具和未知工具不走这条规则，避免把副作用工具误判成安全重复。

- [ ] **优点4：证据和隐私处理很稳。** 工具参数先规范化再 hash，metadata 只暴露 hash，不暴露原始参数，既能定位重复，又不会把 secret 带到日志或结果里。

- [ ] **优点5：纯逻辑和运行时副作用分离。** controller 只返回决策，不负责打印、执行或改消息；这让单测容易写，运行时也能分别处理顺序执行、并发执行、流式输出。

---

## 改进点

- [ ] **改进点1：幂等工具列表需要持续维护。** 新增 read-only 插件或 MCP 工具时，如果没加入 idempotent 列表，就只能靠同工具失败检测，无法识别“成功但无进展”的重复读取。

- [ ] **改进点2：阈值现在偏通用。** 不同工具的正常重试次数不一样，比如搜索可以多试几次，终端失败可能更快提示诊断。后续可以支持按工具覆写阈值。

- [ ] **改进点3：warning 的效果依赖模型是否吸收提示。** 它把建议附回 tool result，但模型仍可能忽略。hard stop 能兜底，但默认体验仍取决于模型行为。

---

## 风险点

- [ ] **风险点1：idempotent 分类不准会误导判断。** 如果把有副作用的工具错放进幂等列表，连续相同结果可能被误判为无进展；当前用 mutating 列表兜底，但列表维护仍然重要。

- [ ] **风险点2：hard stop 开太激进会中断合理探索。** 当阈值设置过低时，模型可能还没来得及换参数就被 block，所以默认关闭 hard stop 是一个重要保护。

- [ ] **风险点3：失败分类必须和 UI 保持一致。** 如果 CLI 显示不是失败，但 guardrail 认为失败，模型会收到矛盾信号；代码里通过显式 `failed=` 和 fallback classifier 保持一致。

- [ ] **风险点4：只解决工具层循环，不解决所有卡死。** 比如模型空回复、provider 中断、上下文压缩循环属于其他 guardrail 或 retry 机制的职责，不能把所有稳定性问题都塞给这个模块。

---

## 面试回答框架（3-5 分钟）

> 这是你可以直接拿来练习的"面试回答提纲"。对着镜子或录音练一遍，控制在 3-5 分钟。

**开场（30秒）：**
"我会讲 Hermes 里的 ToolCallGuardrailController。它解决的是 agent 在工具调用里原地打转的问题，比如同一个搜索一直失败，或者反复读同一个文件拿到同样结果。"

**背景（30秒）：**
"只靠 max_iterations 太晚了，等总次数耗尽用户已经等很久。我们需要在工具层更早发现循环，但又不能误伤正常调试，所以这个设计默认不是拦截，而是先提醒模型换策略。"

**设计（1-2分钟）：**
"核心思路是把循环拆成三类：同参数重复失败、同工具连续失败、幂等工具同结果无进展。我们用 tool name 加规范化参数 hash 做签名，既能识别同一调用，又不暴露原始参数。默认 warning 会附回 tool result；如果配置打开 hard stop，下一次重复调用前才会被 block，严重时 halt 当前 turn。"
"这里的 trade-off 是：直接阻断最安全但太容易误伤，只靠总迭代又太晚。所以我们选 warning-first，加一个可配置断路器。"

**反思（30秒）：**
"这个设计好的地方是边界很清楚：controller 只做判断，运行时负责把判断变成 tool result 或最终回答；而且幂等工具和写工具分开处理。风险是工具分类和阈值要维护好，尤其是新插件工具进来后，哪些算只读要持续校准。"

---

## 证据索引

> 这里不是放代码或代码片段，只做源码复习定位。每个模块控制在 3-6 条，优先写关键文件、类名、方法名。

- `agent/tool_guardrails.py` — `ToolCallGuardrailController.before_call` / `after_call`：重复失败、同工具失败、幂等无进展的核心判断。
- `agent/tool_guardrails.py` — `ToolCallSignature.from_call` / `canonical_tool_args`：稳定识别同一工具调用，并避免暴露原始参数。
- `agent/tool_guardrails.py` — `ToolCallGuardrailConfig.from_mapping`：从 `tool_loop_guardrails` 读取 warning 和 hard stop 阈值。
- `agent/tool_executor.py` — `_execute_tool_calls_concurrent` / `_execute_tool_calls_sequential`：顺序和并发工具路径里的 guardrail 接入点。
- `run_agent.py` — `_append_guardrail_observation` / `_guardrail_block_result` / `_toolguard_controlled_halt_response`：把决策转换成 warning、合成 tool result 或最终 halt 响应。
- `tests/agent/test_tool_guardrails.py` — `test_*guardrail*`：验证默认 warning、hard stop、幂等无进展、状态 reset 等边界。

---

## 延伸阅读

- `tests/run_agent/test_tool_call_guardrail_runtime.py`
- `tests/run_agent/test_agent_guardrails.py`
- `agent/turn_context.py`
