# 多 Gateway 部署

Hermes 支持多个 gateway 进程并发运行，每个 profile（default、writer、admin、coder、researcher）对应一个进程。每个 gateway 都会建立自己到平台 API 的连接，并向其 profile 的订阅者交付消息。

任务订阅也覆盖 review 反馈。`changes_requested` review 事件会作为可操作的 review-BLOCK 通知交付。使用 `notify+wake` 的订阅还会唤醒确切的原始 chat/thread/session，使 controller 检查现有卡片和当前 run；`notify` 仍然仅被动通知，`wake` 仍然仅负责唤醒。Review 反馈绝不会创建、解除阻塞、重新入队或以其他方式修改任务。

## 单调度器部署姿态

只有一个 gateway 拥有 kanban dispatcher。该 gateway 保持 `kanban.dispatch_in_gateway: true`（默认值）；其他每个 gateway 都将它设为 `false`。

**重要性：**调度采用单所有者模式，避免多个 gateway 竞争启动同一份工作。通知交付则由 profile 拥有：每个 gateway 只轮询它所托管的平台 adapter 对应 profile 的订阅。原子事件 claim 可避免 watcher 进程之间重复交付。

## 配置

在拥有调度权的 gateway（通常是 `default` profile）上无需更改。在其他每个 profile gateway 上，向 `~/.hermes/config.yaml` 添加：

```yaml
kanban:
  dispatch_in_gateway: false
```

或设置环境变量：`HERMES_KANBAN_DISPATCH_IN_GATEWAY=false`

## 每个 Gateway 的职责

| Gateway 角色 | dispatch_in_gateway | 是否打开已订阅的看板 DB？ | Dispatcher | Notifier |
|---|---|---|---|---|
| default（已确认的 dispatch lock 所有者） | true（默认） | 是 | 是 | 所属 profile + 旧版未标记订阅 |
| writer、admin、coder 等 | false | 是，前提是该 profile 有订阅 | 否 | 该 gateway 拥有的 profile |

非调度 gateway 仍会通过自己的平台 adapter（Telegram、Discord 等）交付消息。它们不调度任务，并会跳过那些不包含其 profile 所有订阅的看板。
