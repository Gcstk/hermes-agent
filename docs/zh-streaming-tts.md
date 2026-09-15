# 流式 TTS

Hermes 可以在 provider 返回音频时立即流式播放，而不必等完整音频生成后再播放。该能力用于语音模式（CLI/TUI 实时对话）、dashboard 的 speak-stream WebSocket，以及通过 gateway `StreamingTTSConsumer` 接入流式音频的任意平台 adapter。语音回复会在第一个分句生成后开始播报，而不是等到“完整生成 + 完整合成”结束。

## 架构

流式流水线由四部分构成：

1. **Producer（生产者）** — LLM 在生成响应时输出文本 delta。
2. **Sentence chunker（句子分块器）** — `tools.tts_streaming.SentenceChunker` 累积 delta，移除 `<think>` 块（即使该块跨多个 delta），并在句子完整时 flush。
3. **TTS provider** — 已注册的 `StreamingTTSProvider` 把每个句子转换为原始 PCM 分块（int16 单声道，采样率为 provider 声明的 `sample_rate`）。
4. **Audio sink（音频接收端）** — 本地播放使用 `sounddevice.OutputStream`（`tools.tts_tool_speaker.stream_tts_to_speaker`）；gateway 平台 adapter 则使用 `write_streaming_tts` seam（`gateway/streaming_tts_consumer.py`）。

没有分块 API 的 provider 仍可通过经过验证的同步 `text_to_speech_tool` 路径按*句子*播放，因此默认的 edge provider 同样具备对话体验。所有朗读文本统一由 `tools.tts_text_normalize.prepare_spoken_text` 清洗，所有路径共用一个 cleaner。

## 如何选择 Provider

默认情况下，如果已配置的 provider（`tts.provider`）具有分块 API，dispatcher 就使用它进行流式合成。系统不会仅为获得流式能力而静默切换到其他 provider，从而改变用户的音色。

如需覆盖默认行为，请在 `config.yaml` 中设置 `tts.streaming.provider`：

- 指定 provider 名称（`elevenlabs`、`gemini`、`openai`、`xai`）可固定使用该 streamer；
- 设置为 `auto` 会按 `elevenlabs → gemini → openai → xai` 优先级顺序查找，使用第一个能解析出凭据的 provider。这是对“使用当前可用的最佳分块语音”的显式选择。

```yaml
tts:
  provider: gemini
  streaming:
    provider: gemini      # 或 "auto"
  gemini:
    model: gemini-2.5-flash-preview-tts
    voice: Kore
```

## 能力矩阵

| Provider | 传输方式 | 分块 PCM | 凭据 |
|---|---|---|---|
| elevenlabs | 分块 HTTP（`pcm_24000`） | 是 | `ELEVENLABS_API_KEY` / `tts.elevenlabs` |
| openai | 分块 HTTP（`with_streaming_response`、`pcm`） | 是 | `tts.openai.api_key` → env → managed gateway |
| gemini | SSE（`streamGenerateContent?alt=sse`） | 是 | `GEMINI_API_KEY` / `GOOGLE_API_KEY` |
| xai | WebSocket（`wss://api.x.ai/v1/tts`） | 是 | xAI OAuth 或 `XAI_API_KEY` |
| edge、piper、kitten、neutts、mistral、minimax、deepinfra 等 | — | 否（按句同步 fallback） | 与往常相同 |

所有凭据查找都通过 `resolve_provider_secret()`（config > env/.env > credential pool），绝不直接读取环境变量。每个句子的流式响应体上限为 16 MiB，与同步 provider 的有界上游响应体不变量保持一致。

## 新增流式 Provider

1. 在 `tools/tts_streaming.py` 中继承 `StreamingTTSProvider`。
2. 设置 `sample_rate`；如果不是 int16 单声道，还要设置 `channels` / `sample_width`。
3. 实现 `available()`（纯探测，绝不安装任何内容）以及 `stream(self, text) -> Iterator[bytes]`，后者 yield 原始 PCM 分块。
4. 使用 `@register("yourname")` 装饰。
5. 在 `tests/tools/test_tts_streaming.py` 中添加测试。

ABC 强制执行契约，registry 让 provider 可被发现；dispatcher（`stream_tts_to_speaker`）和 gateway consumer 会免费处理句子缓冲、停止事件与 audio sink。

## Gateway 流式传输（平台 Adapter）

`gateway/streaming_tts_consumer.py` 将 agent delta 桥接到 adapter 的流式音频 seam。Adapter 通过在 `BasePlatformAdapter` 上覆盖以下接口来选择启用：

- `supports_streaming_tts(chat_id, audio_format) -> bool`
- `begin_streaming_tts / write_streaming_tts / finish_streaming_tts / abort_streaming_tts`

这些接口默认均为不支持/no-op，因此现有 adapter 不受影响。当某一轮的流式音频正常完成时，该轮基于完整文件的 auto-TTS 回复会被抑制，避免重复播放；如果流式处理在任何音频可听见之前失败，gateway 会 fallback 到旧版的完整文件语音回复。
