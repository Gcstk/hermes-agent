# 架构决策记录（ADR）

## 2026-07-13：按 Hermes home/profile 限定插件管理器状态（键控缓存）

状态：已接受

背景：
Hermes 通过不同的 Hermes home 目录支持多个 profile。运行中的进程有两种 home 切换方式：`HERMES_HOME` 环境变量（单 profile CLI/gateway 进程），以及上下文本地的 `set_hermes_home_override()`（`hermes_constants.py`）。多路复用 gateway worker（`gateway/run.py` 的 `_profile_scope`）和 subagent/嵌入式调用方使用后者，让一个长寿命进程服务多个 profile。该 override 是 `ContextVar`，且刻意不修改 `os.environ`，否则一个 profile 的 home 会泄漏给同一进程中的其他并发任务。

插件管理器原先是进程全局的单槽 singleton（`_plugin_manager`）。用户安装的插件从 `get_hermes_home() / "plugins"` 发现；context-engine 插件（如 `hermes-lcm`）会在注册时捕获 profile-scoped 状态，例如 LCM 数据库路径。单槽缓存造成两个问题：

1. 通过 `set_hermes_home_override()` 切换 home 对简单的“`HERMES_HOME` 是否变化”检查不可见，所以 singleton 会静默地把第一个 profile 的 manager 提供给进程中的其他 profile。
2. 即使为新 home 创建了新的 `PluginManager`，`_load_directory_module` 也会把插件模块以 `hermes_plugins.<slug>` 导入 `sys.modules`，而原实现只替换这个顶层模块。同 slug 插件的相对导入（`from . import state`）另行缓存在 `hermes_plugins.<slug>.<submodule>` 下。Python 导入机制会优先从 `sys.modules` 解析它们，因此切换 profile 后仍可能沿用前一个 profile 已导入的子模块代码或状态，而不是重新执行新 profile 的插件。

决策：

- 用以解析后的 Hermes home 路径为键的缓存（`_plugin_managers_by_home: Dict[Path, PluginManager]`）替换单槽 singleton。`get_plugin_manager()` 通过 `get_hermes_home()` 解析当前 home；后者已经先查询 `get_hermes_home_override()`，再查询 `os.environ`，因此环境变量与上下文本地 override 两条路径得到统一覆盖。
- 旧单槽名称 `_plugin_manager` 只作为轻量的“最后返回 manager”指针保留，以兼容执行 `monkeypatch.setattr(plugins_mod, "_plugin_manager", some_manager)` 的现有测试。当它被 monkeypatch 为键控缓存未知的 manager 时，`get_plugin_manager()` 将其视为显式注入，并在当前解析的 home 下纳入缓存，而不是丢弃。
- `PluginManager._load_directory_module`（同一 home 内首次加载或 `force=True` 重载）和共享 helper `_clear_plugin_submodules`（profile 切换或测试 teardown）都会在重新导入插件 slug 前，从 `sys.modules` 中驱逐 `sys.modules[module_name]` 以及所有以 `module_name + "."` 开头的名称，确保相对导入子模块无法跨重载或 home 切换存活。
- 测试隔离（`tests/conftest.py` 的 `_hermetic_environment` fixture）调用新的 `_reset_plugin_managers_for_tests()` helper，在测试之间丢弃整个键控缓存并清除 `sys.modules` 中的全部插件子模块，而不是只重置单槽指针。

结果：

- 无论 profile 通过 `HERMES_HOME` 还是 `set_hermes_home_override()` 切换，每个 profile 的 LCM 实例（及其他 context-engine 插件）都会使用自己的 `{home}/lcm.db`。
- 为保证正常性能，插件发现仍在 profile 内缓存；再次进入先前访问过的 profile 时会复用其缓存 manager，而不是从头构建。
- 无论 profile 顺序切换还是交错切换，在测试、gateway multiplexer worker 或使用上下文本地 override 的嵌入式调用方中，都不再跨 profile 泄漏 context-engine 状态、插件模块状态或陈旧的相对导入子模块。
- 回归测试覆盖真实生产路径 `set_hermes_home_override()`，而不只覆盖环境变量路径，并包含专门的相对导入泄漏测试。
