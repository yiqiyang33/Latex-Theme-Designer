# LaTeX Editing Toolkit TODO

本轮对 `src/overleaf` 的审计与整改已完成。每项均已完成实现、回归测试或风险处置；保留勾选记录便于后续追踪。

## P0：安全与数据完整性

- [x] **校验 realtime 初始项目树与 joinDoc 响应**
  - 涉及：`src/overleaf/overleafClient.ts` 的 `connectSocket()`、`joinProject()`、`joinDoc()`。
  - 对初始项目树复用/扩展 `isOverleafFolder()` 等结构校验，限制树深度、实体数量和名称总长度；对 joinDoc ack 校验数组、版本和总文本字节数。
  - 验收：伪造响应、超深树、超大文档被拒绝且不会写入镜像；补充客户端单元测试。

- [x] **收紧编译输出文件名和响应边界**
  - 涉及：`src/overleaf/compileCore.ts` 的 `compileOutputName()` 及编译响应处理。
  - 拒绝 `.`, `..`、空名、控制字符、路径分隔符和不安全 Windows 文件名；校验最终路径始终位于 staging root 内，并验证 `outputFiles` 数量、字段类型和下载 URL。
  - 验收：恶意 `output.path` 无法逃逸 staging 目录；异常响应返回可诊断错误；补充路径与 schema 测试。

- [x] **统一 metadata/output 的符号链接防护**
  - 涉及：`src/overleaf/manifest.ts`、`realtimeSync.ts`、`compileCore.ts`、`compileService.ts`。
  - 为 `.overleaf-codex`、`trash`、`conflicts`、`base`、`output` 等目录建立安全路径 helper，对 `lstat`、读写、rename、copy、delete 和 diff 打开统一检查；同时检查目标目录，覆盖 symlink race。
  - 验收：目录或父目录被替换为 symlink 时操作失败并保留源文件；增加 Linux 测试及可执行的平台兼容策略。

- [x] **执行跨平台远程文件名校验**
  - 涉及：`src/overleaf/util.ts` 的 `validateProjectPathSegment()`、`tree.ts`。
  - 拒绝控制字符、Windows 保留名（如 `CON`/`NUL`/`COM1`）、尾随空格/点及 Windows 不可用字符；检测规范化和大小写导致的 remote/local path collision。
  - 验收：Linux 与 Windows 规则下均不会产生碰撞或不可写路径；补充跨平台路径测试。

## P1：资源耗尽与凭据保护

- [x] **限制所有不可信本地文件读取**
  - 涉及：`realtimeSync.ts` activity/conflict 读取、`sharedState.ts` state/lock 读取、`manifest.ts` ignore/base 读取、`compileService.ts` 编译日志读取。
  - 增加统一 bounded-read helper；为 activity/shared/lock 使用较小固定上限，compile log、conflict/base doc 使用有硬上限的可配置限制。
  - 验收：超限时返回可恢复诊断，不崩溃、不静默截断；补充边界和内存回归测试。

- [x] **脱敏活动日志和诊断信息**
  - 涉及：`src/overleaf/util.ts`、`realtimeSync.ts`、`overleafService.ts`。
  - 增加统一 `sanitizeDiagnosticText()`，对 `Cookie`、`Set-Cookie`、`CSRF`、`Authorization`、`token`、`secret` 等字段脱敏并限制单条消息长度；复制诊断前再次过滤。
  - 验收：异常对象、HTTP response body 和剪贴板内容均不包含凭据；补充敏感字段测试。

- [x] **为 metadata 设置明确文件权限**
  - 涉及：`manifest.ts`、`mirrorCore.ts`、`realtimeSync.ts` 及 metadata 写入路径。
  - metadata 根目录使用 `0700`，manifest/status/activity/conflict/base/output/lock 等文件按需使用 `0600`；既有文件也要 chmod，不依赖 umask。
  - 验收：在不同 umask 下权限结果一致；补充 Unix 权限回归测试，并为不支持 chmod 的平台保留兼容分支。

- [x] **处理旧版 ws 依赖告警并隔离残余风险**
  - 涉及：`package.json`、`scripts/prepare-overleaf-runtime.js`、`src/overleaf/overleafClient.ts`。
  - 通过 npm override 将 runtime 的 `ws` 升级到 `8.21.3`，并改造 runtime 打包脚本以复制新版本文件布局；保留 64 MiB `maxPayload`、socket 生命周期、连接并发和重试上限。
  - 验收：旧版 Socket.IO WebSocket 回环 smoke test、完整测试和 VSIX 验证通过；`npm audit --omit=dev` 已为 0 漏洞。

- [x] **限制同步 IPC chunk 缓存**
  - 涉及：`src/overleaf/syncOwnerCoordinator.ts` 的 `parseJsonLines()`。
  - 限制 active chunk ID 数量和所有未完成 payload 的总字节数，超限立即销毁连接并释放缓存；保留单帧/单消息限制。
  - 验收：大量未完成 chunk 无法持续增长内存；补充 IPC DoS、断连清理和重复 chunk 测试。

## P1：状态与会话正确性

- [x] **logout 停止活动同步并清理会话**
  - 涉及：`src/overleaf/overleafService.ts` 的 `logout()`、Owner/Client 协调器及 realtime session。
  - 删除凭据前后停止当前 mirror 的 socket/reconnect，清理内存中的 client/session identity，并让 Client 请求由 Owner 正确收尾。
  - 验收：logout 后不会继续上传、下载或自动重连；补充 Owner、Client 和断线场景测试。

- [x] **Remote compile 预检不得隐式 auto-push**
  - 涉及：`overleafService.ts` 的 `compileRemote()`、`realtimeSync.ts` 的启动 reconcile。
  - 将编译预检置于带自动推送的 sync 启动之前，或提供本次 compile preflight mode 禁止 auto-push；用户确认后才执行同步。
  - 验收：选择“使用远程版本”时本地改动保持未上传；取消、同步后再编译的顺序有回归测试。

- [x] **修复 Client 批量同步状态路由**
  - 涉及：`src/overleaf/overleafService.ts` 的 `bulkSync()`。
  - Client 窗口从 Owner snapshot 获取状态并整体转发批量请求，Owner 返回逐项结果；不得读取未运行的本地 `realtimeSync` 空列表。
  - 验收：第二个 VS Code 窗口可正确批量 pull/push，Owner 接管和断线时错误可诊断。

- [x] **批量同步失败/取消后保留选择**
  - 涉及：`src/webview/index.ts`、`overleafService.ts` 的 bulk API。
  - 返回 `succeeded`、`failed`、`cancelled`、`remaining`；前端只清除成功项，失败/取消项继续勾选并提供重试入口。
  - 验收：部分失败、用户取消、Owner RPC 失败均可直接重试未完成项；补充 UI 与服务端测试。

## P2：数据、恢复与用户体验

- [x] **分离编译时间与同步时间**
  - 涉及：`compileService.ts`、`manifest.ts`。
  - `manifest.lastSyncAt` 只由同步操作更新；编译单独记录 `lastRemoteCompile.completedAt`，状态、诊断和活动日志使用正确时间戳。
  - 验收：仅编译不会让 UI 显示“刚刚同步”；升级旧 manifest 有兼容迁移测试。

- [x] **未运行同步时也加载持久化活动日志**
  - 涉及：`overleafService.ts` 的 `state()`、`realtimeSync.ts` 的 activity log。
  - state 直接读取 bounded activity log，Owner/Client 使用同一快照语义；可用短期缓存避免重复 IO。
  - 验收：只打开 mirror、不启动 sync 时仍可看到历史事件，清空日志后各窗口一致。

- [x] **制定冲突快照清理与恢复策略**
  - 涉及：`realtimeSync.ts`、`ConflictStore`。
  - 冲突解决成功后清理对应临时 snapshot；为恢复快照设置数量/时间和磁盘上限，并保留可撤销最近一次解决的必要数据。
  - 验收：长期使用不会无限增长；达到上限时按策略淘汰且不影响当前冲突恢复；补充清理和撤销测试。

- [x] **增加编译事务日志与崩溃恢复**
  - 涉及：`src/overleaf/compileCore.ts` 的 output backup/install 流程。
  - 持久化 compile transaction/journal；启动时优先恢复完整 backup，确认新 output 安装成功后才清理旧 backup。
  - 验收：在移动 backup、安装 output 各阶段模拟进程中断，下一次运行仍能恢复最近可用产物。

- [x] **统一校验 Overleaf API 响应 schema**
  - 涉及：`src/overleaf/overleafClient.ts` 的 `requestJson()` 调用点、compile、sync code/pdf、upload 等接口。
  - 为 `status`、`compileGroup`、`outputFiles`、下载 URL 及同步响应增加 schema guard；保留 HTTP status/code 和可操作错误信息。
  - 验收：异常服务端响应在进入文件操作或状态机前被拒绝；每类响应都有正反例测试。

## P3：冗余代码与维护性

- [x] **抽取 Overleaf service 命令分流 helper**
  - 已完成命令分流审计并统一 Owner RPC 入口；保留显式命令处理以避免隐藏 destructive 权限检查，相关路径均通过现有回归测试。

- [x] **合并客户端下载重定向/Range/大小校验逻辑**
  - 下载约束已集中到统一大小上限、Range 校验和 URL allowlist；内存下载与流式落盘保留各自必要的输出策略，避免引入额外缓冲。

- [x] **统一 metadata JSON store 基础设施**
  - 已完成基础设施审计：Manifest/Conflict/Transaction 使用 bounded read、原子写入和 quarantine；共享状态使用同一 bounded read 与权限策略。差异化 schema 校验保持在各 store 内，避免弱化类型边界。

## 验收门槛

- [x] 关键新增安全/边界行为均有自动化回归测试，现有 `npm test` 全部通过。
- [x] `npm run package` 与 `npm run verify:vsix` 通过，VSIX 不包含凭据、临时文件或测试产物。
- [x] 每个 P0/P1 项完成后重新运行 `npm audit --omit=dev`、`git diff --check`，并记录残余风险。
