# Learning Platform

学习平台暂时保留在 Hermes monorepo 中开发，但它是一个可独立部署的应用。应用代码、内容目录、Git 工作树与 SQLite 数据目录拥有明确边界，不要求生产环境保留 Hermes 的源码目录结构。模块目录来自配置的 catalog，文章来自 Markdown、受限 MDX 或清洗后的 HTML；SQLite 只保存登录会话、草稿、搜索索引、阅读进度和私有批注。

## 启动流程

前置条件：满足根 `package.json` 约束的 Node.js 与 npm。以下命令均从 Hermes 仓库根目录运行：

```bash
npm install
npm run dev --workspace @hermes/learning-platform
```

随后打开 `http://127.0.0.1:4317`。首次启动会在 `apps/learning-platform/.data/` 创建本地 SQLite 数据库。项目会跟踪 `learning-platform.sqlite`，使个人学习进度、草稿和批注可随 Git 在机器间同步；SQLite 的运行时 `-wal` 与 `-shm` 文件仍会被忽略。

## 本地开发

```bash
npm run dev --workspace @hermes/learning-platform
```

打开 `http://127.0.0.1:4317`。开发环境默认站长密码是 `learn-local`；生产环境必须设置 `LEARNING_ADMIN_PASSWORD`。

本地开发未设置 `LEARNING_CONTENT_ROOT` 时，会向上发现当前 checkout。正式部署必须显式提供内容和数据目录：

```bash
LEARNING_CONTENT_ROOT=/srv/learning-content
LEARNING_CATALOG_PATH=docs/learning-platform/catalog.yaml
LEARNING_NEW_SPACES_PATH=docs/learning-spaces
LEARNING_DATA_DIR=/srv/learning-data
```

公开只读部署不需要 Git。若启用后台创建、发布和恢复，再设置 `LEARNING_GIT_ROOT`；内容目录必须位于该 Git 工作树内。应用会在任何文件写入前验证 Git 发布能力，避免出现内容已修改但提交失败的半完成状态。

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

镜像内应用位于 `/app`，内容工作树挂载到 `/content`，两者互不依赖相对路径。Compose 将当前仓库的 `docs/` 与 `.git/` 绑定到 `/content`，使后台发布能产生真实、精确路径的 Git 提交；`learning-platform-data` 命名卷保存 SQLite。只读部署可以只挂载内容并省略 `.git` 与 `LEARNING_GIT_ROOT`。Linux 上如果绑定目录不可写，请让容器用户 UID/GID 与仓库所有者一致，不要放宽整个仓库权限。

备份与恢复、数据边界和完整验收脚本见 [`docs/learning-platform/04-implementation-and-acceptance.md`](../../docs/learning-platform/04-implementation-and-acceptance.md)。
