# Overleaf Codex TODO

本清单来自 2026-08-16 对 Overleaf Codex 组件的代码审查。完成并验证后再勾选对应项目。

## P0

- [x] 远端文件或目录重命名/移动时，禁止覆盖已存在的本地目标；本地文件系统操作失败时不得提前改写 manifest，并为失败路径设置同步阻塞状态。

## P1

- [ ] 将 CLI `OverleafSyncEngine` 与扩展 `RealtimeSyncService` 的 reconcile、push/pull、rename、冲突和二进制事务逻辑抽取为真正共享的同步核心。
- [ ] 统一 `sync --once` 在 CLI owner 和扩展 owner 下的行为，确保安全拉取和推送语义不随 VS Code 是否运行而改变。
- [ ] `push`、`pull` 完成后执行 targeted status refresh，返回最新报告并给出正确退出码。
- [ ] 支持通过 `push --force` 恢复已在远端删除、但本地仍保留的文件，不再复用失效 entity ID。
- [ ] 保证 `status`、`status --refresh` 和 `status --full` 为只读操作；远端写入只允许由明确的 sync/push 命令或 watcher reconciliation 触发。

## P2

- [ ] CLI incremental check 复用 `SyncHealthService` 的远端元数据缓存，并为二进制下载设置有限并发，避免每次全量串行读取。
- [ ] 为共享 `overleaf.json` 的 read-modify-write 增加跨进程串行化，避免扩展与 CLI 并发更新时丢失配置或镜像记录。
- [ ] 合并 CLI `mirrorCore` 与扩展 `MirrorManager` 的镜像创建流程，统一支持文件、LaTeX Workshop 配置、清理和 Git 初始化行为。
- [ ] 修复 owner 启动窗口期：锁已创建但 socket 尚未监听时进行有限重试；为订阅握手增加超时。

## P3

- [ ] 去除 VSIX 中重复的 `dist/vendor` 与 `dist/cli-vendor` Socket.IO runtime，保留单一来源并在 CLI 安装时复用。
- [ ] 远端编译产物先下载到 staging 目录，全部成功后再原子替换旧输出；按修改时间选择最新 PDF，并避免同名输出覆盖。
- [ ] 减少 Keychain、SecretStorage 和共享设置桥接中的重复状态，避免凭据作为子进程参数暴露并减少无变化的 VS Code 全局设置写入。

## 测试缺口

- [x] 覆盖远端 rename/move 目标已存在、文件系统失败及 manifest 回滚。
- [ ] 覆盖 CLI owner 与扩展 owner 的命令结果一致性。
- [ ] 覆盖 push/pull 后的状态、JSON envelope 和退出码。
- [ ] 覆盖远端删除后的强制恢复与 CLI incremental 远端缓存复用。
