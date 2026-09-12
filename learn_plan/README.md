# Hermes Agent 核心学习计划索引

这组文件用于系统学习 Hermes Agent 的核心 agent 机制。当前范围以 Python agent core 为主，暂不把 app、desktop、web 前端作为主线；但会保留必要的交互边界，帮助理解 CLI、gateway、TUI、desktop 如何调用同一套核心能力。

## 阅读顺序

1. `00-总路线.md`：学习目标、边界、阶段安排和验收标准。
2. `01-核心代码地图.md`：按真实仓库结构整理的核心入口、数据流和测试入口。
3. `02-阶段学习计划.md`：从易到难的阶段任务，每一阶段都有阅读文件、问题清单、实践任务。
4. `03-重点专题深挖.md`：skills、memory、自进化、harness、prompt caching 等出彩点专题。
5. `04-学习记录模板.md`：之后每学一个模块，就按模板追加学习笔记。
6. `05-harness工程专题.md`：用 Hermes 的真实代码讲 agent harness 的行动空间、观察、恢复、上下文预算和安全边界。
7. `06-时间复杂度评估.md`：基于行业常用估算/复杂度标尺，为每个学习模块标注预计时间、复杂度、风险和推荐节奏。
8. `07-输出驱动掌握路线.md`：回答“要学多久、学到什么程度、如何用费曼法输出”，并给出重点/深思/略读分层。
9. `08-验收清单与输出题库.md`：把每个核心能力转成可交付题目、自测问题、代码证据和测试证据。
10. `09-面试官视角题库.md`：以面试官视角整理问题、追问、优秀回答要点、红旗回答、源码/测试证据和面试冲刺计划。

## 本轮已确认的核心事实

- `run_agent.py` 仍是 `AIAgent` 的大门面，但 `AIAgent.run_conversation()` 已转发到 `agent/conversation_loop.py`。
- 真实 turn prologue 被抽到 `agent/turn_context.py`，turn 收尾被抽到 `agent/turn_finalizer.py`。
- 工具系统是 `tools/registry.py` 自注册，`model_tools.py` 发现、缓存 schema 并分发，`toolsets.py` 收束工具面。
- skills 是过程记忆主线：`agent/skill_commands.py` 负责 slash 命令注入，`tools/skill_manager_tool.py` 负责 agent 创建/编辑技能，`agent/learn_prompt.py` 是 `/learn` 的提示构造核心。
- memory 是声明式/用户建模主线：`agent/memory_provider.py` 定义 provider 接口，`agent/memory_manager.py` 编排 provider、工具 schema 和 turn hooks，`plugins/memory/` 提供多个后端。
- 自进化闭环集中在 `/learn`、`skill_manage`、`skill_usage`、`curator`、`curator_backup`、memory/session search 的组合上。
