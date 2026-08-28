# LaTeX Editing Toolkit TODO

下一阶段重点是修复多窗口同步边界，并把同步、远程编译和冲突处理做成可预期、可恢复的用户流程。每项完成实现、回归测试和打包验证后再勾选。

## P0：多窗口同步完整性

- [x] **补齐 Owner/Client RPC 路由**
  - Client 窗口的 retry、diff、冲突查看/解决、Collaborators、remote-deleted trash 全部通过 Owner RPC 执行。
  - Owner 端增加对应命令、参数校验和错误码，避免 Client 误报 `Realtime sync is not running`。
  - 补充两个 VS Code 窗口、Owner 退出、Owner 接管和 RPC 失败后的回归测试。

## P1：远程编译可靠性

- [x] **Remote Compile 同步预检**
  - 编译前检查 local-ahead、remote-ahead、diverged、删除和同步错误状态。
  - 有未同步变更时提供“先同步 / 继续使用远程旧版本 / 取消”选择。
  - 同步或编译过程中支持取消，避免重复请求和状态竞争。

- [x] **保存真实编译产物路径**
  - 记录最近一次 PDF、日志和其他输出文件的实际路径。
  - “View PDF”和“Show Log”始终打开本次编译对应的文件，不依赖固定的 `output.log` 文件名。
  - 编译失败时保留上一次可用 PDF，并明确标记其版本时间。

## P1：依赖安全与兼容性

- [x] **处理生产依赖安全告警**
  - 升级 `brace-expansion`/`minimatch` 到包含修复的版本。
  - 评估 `uuid` 升级方案，确认当前 v4 调用点的兼容性。
  - 为旧版 Overleaf Socket.IO runtime 的 `ws` 漏洞制定迁移方案：协议必须保持兼容，已增加 64 MiB frame 边界；上游暂无修复，审计仍报告该残余风险。
  - 运行 `npm audit --omit=dev`、单元测试、VSIX 验证，并记录剩余风险。

## P2：同步操作体验

- [x] **批量同步进度与取消**
  - 展示已完成、失败、剩余路径和当前操作。
  - 支持用户取消，取消后保留未处理选择。
  - 单个路径失败后继续处理其他路径，并提供逐项重试。

- [x] **持久化同步活动日志**
  - 保存最近 100 条连接、重试、上传、下载、冲突、Owner 接管和编译事件。
  - 日志带时间、路径、结果和耗时，超过上限自动淘汰旧记录。
  - 提供清空日志和复制诊断信息入口，敏感信息不得写入日志。

- [x] **统一同步状态语义**
  - 明确 `blocked-auth`、`blocked-tree`、`reconnecting`、`checking`、`ready` 的显示优先级。
  - 状态徽章、Activity Bar、Webview 和通知使用同一套状态文案。
  - 显示最后成功同步时间、当前失败原因和下一步操作。

## P2：冲突处理

- [x] **增强三方冲突解决体验**
  - 提供 base/local/remote 导航，并在解决前保存可恢复的本地快照；当前 VS Code 稳定 API 尚无可靠 Merge Editor 调用入口。
  - 文本冲突支持按块选择变更，二进制冲突显示大小、hash、修改时间和可恢复操作。
  - 解决前保存快照，解决后支持重新检查和撤销提示。

## P2：接口与错误处理

- [x] **收敛 Overleaf API fallback**
  - `listProjects()` 只在 404/405 等接口不兼容时从 POST fallback 到 GET。
  - 网络超时、认证失败和服务端错误直接保留原始错误类型与诊断信息。
  - 为各类错误提供用户可执行的恢复动作，而不是重复请求后再失败。

## P3：登录与新手体验

- [x] **降低登录门槛**
  - 评估浏览器辅助登录或 OAuth 授权，减少手动复制 Cookie。
  - 自定义 Overleaf 服务器提供连通性检查和登录状态说明。
  - Cookie 过期时提供重新登录入口，并明确不会把凭据写入项目目录。

## 验收门槛

- [x] `npm test` 全部通过，并为新增行为补充回归测试。
- [x] `npm run package` 和 `npm run verify:vsix` 通过。
- [x] `git diff --check` 通过，确认 VSIX 不包含凭据、临时文件和测试产物。
