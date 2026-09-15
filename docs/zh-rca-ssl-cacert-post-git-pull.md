# RCA：`hermes update` 后 SSL CA 证书包损坏

**状态：**已通过 `fix(ssl): surface broken CA bundles before provider calls` 解决  
**严重程度：**P2 - 在用户修复依赖或 CA 配置之前，agent 会退化为不透明的 provider/client 失败。

## 摘要

部分完成的 `hermes update`、被中断的 venv 修复，或过期的 CA bundle 环境变量，都可能使 Python TLS 配置指向不存在、为空或无法加载的 CA bundle。此后首次创建对外 HTTPS client 或发起请求时，可能会以原始 `FileNotFoundError: [Errno 2] No such file or directory` 或不指明损坏 CA 路径的底层 SSL 错误失败。

## 根本原因

Hermes 使用基于 OpenAI/httpx 和 requests 的 client 执行 provider 调用、模型元数据获取、gateway 交付和 Web 工具请求。这些 client 会继承以下来源的 CA bundle 设置：

- `HERMES_CA_BUNDLE`
- `SSL_CERT_FILE`
- `REQUESTS_CA_BUNDLE`
- `CURL_CA_BUNDLE`
- 内置 `certifi` 包的 `cacert.pem`

当 venv 仅部分刷新，或上述某个环境变量指向已不存在的文件时，provider client 可能在 Hermes 获得足够上下文以输出有用错误信息之前就创建失败。

## 修复

`agent/ssl_guard.py` 会在 `agent/agent_init.py` 创建 OpenAI 兼容 provider client 之前校验 CA bundle 配置。具体会：

1. 检查显式 CA bundle 环境变量，并报告损坏的确切变量和路径；
2. 验证 `certifi` 可导入；
3. 验证 `certifi.where()` 指向大小合理的现存文件；
4. 使用每个被检查的 bundle 构建 `ssl.SSLContext`；
5. 在 httpx/OpenAI 抛出原始底层错误之前，抛出带修复建议的强类型 `SSLConfigurationError`。

`hermes_cli doctor` 在 `SSL / CA Certificates` 项下暴露了同一检查，因此用户无需启动模型 session 即可诊断问题。

## 恢复

当 guard 在 agent 初始化期间触发时，用户会看到类似以下的消息：

```text
Failed to initialize OpenAI client: SSL_CERT_FILE points to a missing CA bundle: C:\path\to\missing\cacert.pem
Repair: python -m pip install --force-reinstall certifi openai httpx
If you configured a custom corporate CA bundle, fix or unset the broken CA bundle environment variable.
```

对于普通的 Hermes venv 损坏，请重新安装受影响的 client 依赖：

```bash
python -m pip install --force-reinstall certifi openai httpx
```

对于自定义/企业 CA 配置，修正环境变量，使其指向真实的 PEM bundle；如果 Hermes 应使用内置 `certifi` 存储，则取消设置该变量。

## 环境逃生阀

设置 `HERMES_SKIP_SSL_GUARD=1` 可跳过 preflight 检查。该选项仅面向沙箱化或托管信任环境：在这类环境中，Python CA 路径看起来异常，但已知下游 client 能够正常工作。
