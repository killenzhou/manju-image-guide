# nl-workbench — 年轮AI CLI（踏星专用）

单人使用。平台无官方 MCP/CLI，此工具直连 `/business-center` REST API。

## 零配置（自动取 token）

只要在本机 Chrome/Edge 登录过 `nl.nianlunai.com`，CLI 会自动从浏览器 Local Storage leveldb 里读 token，**无需手动复制**。401 时会自动重扫换新 token 重试一次。

兜底：`node nl.mjs token <值>` 手写 `.nl-token` 文件；或 `NL_TOKEN` 环境变量（优先级最高）。

> 无法自动化的部分：密码/短信登录要滑块验证，不做；API Key 仅团队所有者可用（当前账号无权限）。token 是会话型的，过期后在浏览器重新登录一次即可，CLI 下次调用自动取新值。

## 常用

```bash
node nl.mjs user                    # 验证 token
node nl.mjs queue                   # 生成队列
node nl.mjs points                  # 积分/配额
node nl.mjs models                  # 模型与参数
node nl.mjs canvas <canvasId>       # 画布详情
node nl.mjs task <taskId> video --wait     # 等任务出结果
node nl.mjs run-submit <verId> '{"key":"val"}'   # 提交工作流（先 --calc-only 算费用）
node nl.mjs run <runId> --wait               # 等 run 完成
node nl.mjs raw POST /pluginCanvas/save '{...}'  # 万能兜底
```

画布 id 形如 `1794802567883t0543203136`（URL `/nlCanvas?id=…` 里的值）。

## 给其他软件/Agent 用

**方式一：直接调 CLI**（任何能跑 shell 的工具）
```bash
node <此目录>/nl.mjs user
node <此目录>/nl.mjs canvas-save '{"projectId":"…","canvasName":"…"}'
```

**方式二：挂 MCP**（stdio，零依赖）
```json
{ "mcpServers": { "nianlun": { "type": "stdio", "command": "node",
  "args": ["<此目录>/nl-mcp.mjs"] } } }
```
- Devin CLI: `devin mcp add --transport stdio -- nianlun node <路径>/nl-mcp.mjs`
- Codex: `codex mcp add nianlun -- node <路径>/nl-mcp.mjs`
- Claude Desktop/Cursor/Windsurf：按 `mcp-config.example.json` 填

**跨机器**：目标机的浏览器登录一次 nl.nianlunai.com 即可自动取 token；没有浏览器就设 `NL_TOKEN` 环境变量（从已登录机器 `nl.mjs` 所在目录 `.nl-token` 里取当前值）。

## 文件

- `nl.mjs` — CLI 本体
- `nl-mcp.mjs` — stdio MCP server（20 个工具）
- `nl-core.mjs` — token 自动获取 + 请求核心（两者共用）
- `ENDPOINTS.md` — 完整接口地图 + 实测记录
- `mcp-config.example.json` — 各端挂载示例
- `.nl-token` — token 缓存（自动生成，勿外泄勿上传）
