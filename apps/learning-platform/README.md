# Learning Platform

学习平台是 Hermes 仓库内的一个 npm workspace，代码位于 `apps/learning-platform/`，而不是独立仓库。模块目录来自 `docs/learning-platform/catalog.yaml`，文章来自 Git 中的 Markdown、受限 MDX 或清洗后的 HTML；SQLite 只保存登录会话、草稿、搜索索引、阅读进度和私有批注。

## 启动流程

前置条件：Node.js 20 或更高版本，以及 npm。以下命令均从 Hermes 仓库根目录运行：

```bash
npm install
npm run dev --workspace @hermes/learning-platform
```

随后打开 `http://127.0.0.1:4317`。首次启动会在 `apps/learning-platform/.data/` 创建本地 SQLite 数据库；它已被 Git 忽略，不会进入提交。

## 本地开发

```bash
npm run dev --workspace @hermes/learning-platform
```

打开 `http://127.0.0.1:4317`。开发环境默认站长密码是 `learn-local`；生产环境必须设置 `LEARNING_ADMIN_PASSWORD`。

## 质量检查

```bash
npm run check --workspace @hermes/learning-platform
npm run build --workspace @hermes/learning-platform
```

## Docker Compose

从应用目录运行：

```bash
cd apps/learning-platform
export LEARNING_ADMIN_PASSWORD='由密码管理器生成的长密码'
docker compose up --build -d
docker compose ps
```

Compose 将仓库的 `docs/` 与 `.git/` 绑定到容器，使后台发布能产生真实、精确路径的 Git 提交；`learning-platform-data` 命名卷保存 SQLite。Linux 上如果绑定目录不可写，请让容器用户 UID/GID 与仓库所有者一致，不要放宽整个仓库权限。

备份与恢复、数据边界和完整验收脚本见 [`docs/learning-platform/04-implementation-and-acceptance.md`](../../docs/learning-platform/04-implementation-and-acceptance.md)。
