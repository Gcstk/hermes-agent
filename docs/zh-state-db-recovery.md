# 状态数据库与 FTS 恢复

`state.db` 存储两类不同数据：

- `sessions` 和 `messages` 是规范化会话记录（canonical transcript）。
- `messages_fts*` 表及其同步 trigger 是派生搜索索引。

派生索引可以临时解除挂接，但绝不能让实时消息写入或搜索触发无界的全量会话重建。

## FTS 损坏时的实时行为

如果 FTS 写入或搜索报告属于损坏错误类别，`SessionDB` 会：

1. 记录持久化的 `fts_stale` marker；
2. 在同一事务中移除 FTS 同步 trigger；
3. 在不连接派生索引 sink 的情况下重试 canonical 写入；
4. 通过 `LIKE` fallback 从 canonical 行提供搜索。

失败的实时操作绝不运行 `FTS5('rebuild')`。既有恢复职责保持不变：后续打开 `SessionDB` 时，可以在跨进程 admission lock 和外部持有者 guard 保护下执行重建。如果受保护的重建无法运行，FTS 继续保持解除挂接，canonical 写入仍然可用，`hermes doctor` 则报告明确的修复命令。

## 数据库文件本身损坏时的实时行为

如果实时写入报告没有 FTS 来源信息的裸 `SQLITE_CORRUPT` / `SQLITE_NOTADB`（`database disk image is malformed`、`file is not a database`），则损坏位于 canonical B-tree、schema 或 freelist 中。此时 `SessionDB` 会隔离该 handle（`StateDbCorruptError`）：

1. 失败写入向上传播强类型错误，不做任何重试；
2. 该 handle 的后续写入立即失败，且不接触文件；
3. `close()` 后该 handle 绝不重新打开连接；
4. `close()` 跳过显式 WAL checkpoint。

停止写入就是保护措施。在一个现场案例中，某 handle 在首次结构错误后又持续写入约 50 分钟，关闭时把 15 个 page checkpoint 到错误页码（page 1 收到了 `messages_fts_trigram_data` leaf），最终把一个虽然损坏但尚可读取的文件变成完全无法打开的文件。跳过显式 checkpoint 是第二道防线；在 Python 3.12+ 上，隔离还会禁用 SQLite 自身的最后连接 checkpoint（`SQLITE_DBCONFIG_NO_CKPT_ON_CLOSE`），使 `-wal` sidecar 在 `close()` 后仍可用于取证。Python 3.11 不提供该开关，SQLite 仍可能在关闭时 checkpoint 一次，因此在重启任何进程前，应把 `state.db`、`state.db-wal` 和 `state.db-shm` 一并复制。

Gateway 和 agent flush 路径把隔离状态视同文件已被替换：待处理 transcript 写入 `sessions/<id>.jsonl` 和 gateway 的 `pending_messages/` spool，而不是 retry queue；FTS 一次性重建也绝不在损坏文件上运行。隔离以进程为单位：在进程基于修复或恢复后的文件重启前，所有持有者共享的 handle 会一直保持 poisoned 状态。Gateway 仍在运行时不要执行 `hermes doctor --fix`。后续步骤：

```bash
hermes gateway stop
HERMES_HOME="$HOME/.hermes" hermes sessions recover --source "$HOME/.hermes/state.db" --inspect-only
# 如果可恢复：
HERMES_HOME="$HOME/.hermes" hermes sessions recover --source "$HOME/.hermes/state.db" --output "$HOME/recovered-state.db"
```

也可以从 `state-snapshots/` 恢复最新 snapshot。

## 显式修复

修复前，停止所有可能打开该 profile 数据库的进程，并在整个修复和验证窗口内保持停止。

```bash
hermes gateway stop
HERMES_HOME="$HOME/.hermes" hermes sessions repair --check-only
HERMES_HOME="$HOME/.hermes" hermes sessions repair
```

`sessions repair` 默认创建 SQLite backup，并通过仓库内受保护的 snapshot-and-promotion 路径执行结构操作。不要用 `cp` 分别复制 `state.db`、`state.db-wal` 和 `state.db-shm`；它们共同组成一个实时 SQLite image。

修复后，在重启 gateway 前验证 health probe、stale marker、trigger 集合和 canonical 行数：

```bash
HERMES_HOME="$HOME/.hermes" hermes sessions repair --check-only
sqlite3 "$HOME/.hermes/state.db" \
  "SELECT key, value FROM state_meta WHERE key = 'fts_stale';"
sqlite3 "$HOME/.hermes/state.db" \
  "SELECT type, name FROM sqlite_master WHERE name IN
   ('messages_fts_insert','messages_fts_update','messages_fts_delete')
   ORDER BY name;"
sqlite3 "$HOME/.hermes/state.db" \
  "SELECT 'sessions', COUNT(*) FROM sessions
   UNION ALL SELECT 'messages', COUNT(*) FROM messages;"
```

Marker 查询应不返回任何行，预期的 FTS trigger 应存在，canonical 行数不得减少。如果修复失败，请同时保留实时数据库和报告的 backup；绝不要为了让派生索引错误消失而删除 canonical 行。
