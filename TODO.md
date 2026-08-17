# Overleaf Codex TODO

本清单来自 2026-08-17 对 Overleaf 实现的性能、稳定性与冗余代码审查。已完成的历史事项不再保留；任务只有在实现、验证并补齐相应回归测试后才能勾选。

## P0 - 正确性与可用性

- [ ] 修复远端编译锁的永久等待窗口：锁目录缺少或包含无效 `owner.json` 时，结合锁龄判断并安全回收；增加等待截止时间；使用进程启动时间校验避免 PID 复用误判。
- [ ] 修复编译崩溃恢复目录：从真实的 `.overleaf-codex` 元数据根目录扫描并恢复或清理 `output.staging-*`、`output.backup-*`，覆盖旧 output 已移走但新 output 尚未安装的窗口。
- [ ] 让 HTTP timeout 与外部取消信号覆盖完整响应体读取，而不只覆盖 headers；超时或取消时必须终止 text、JSON、普通下载、Range 下载和重定向链。
- [ ] 为 owner IPC 的大型 status/event 响应设计分页、分块或摘要协议；超过限制时返回可诊断的结构化错误，不能直接销毁 socket。

## P2 - 性能与去重

- [ ] 初始 mirror 创建按任务数和实际字节数受控并发：并行创建目录、读取文本和下载二进制，同时保证 `joinDoc`/`leaveDoc` 成对及失败时完整清理。
- [ ] 优化本地扫描：目录遍历及 `stat`/hash 使用有界工作队列；CLI 单次 reconcile 不得无条件执行两到三次完整 `scanLocalProject`。
- [ ] 消除 CLI rename reconciliation 的 O(n^2) 路径：预建缺失父目录、未跟踪根目录、folder fingerprint 和文件 hash 索引；禁止对未跟踪文件使用无界 `Promise.all` 和全量 `readFile`。
- [ ] 为 manifest 维护 `entityId -> path` 的文件和目录索引，并在 create、rename、move、remove、manifest reload 时一致更新，替代实时事件处理中的反复线性扫描。
- [ ] 将 CLI `OverleafSyncEngine` 与扩展 `RealtimeSyncService` 的 check、rename、push/pull、冲突和二进制 mutation 流程下沉为共享状态机；保留宿主 UI、日志和 watcher 适配层。
- [ ] 合并两份目录 fingerprint 实现，并统一扩展与 CLI 的 ignore、文件类型和 hash 规则。
- [ ] 删除未使用的 `listLocalProjectFiles` import；合并扩展 `findPdf` 与 `latestRemotePdf`，统一选择最新 PDF 的规则。

## 回归测试与基准

- [ ] 覆盖编译锁缺少、截断或无效 `owner.json`，PID 复用，锁等待超时，以及每个 staging/backup rename 崩溃窗口。
- [ ] 增加 multipart 二进制上传集成测试，验证 stream chunk 类型、内容、长度和大文件内存峰值。
- [ ] 增加“已返回 headers 但 body 停滞”的 HTTP 测试，分别验证超时和外部取消；覆盖 JSON、下载、Range 和重定向。
- [ ] 使用真实大图片/PDF 验证生产下载路径的任务并发、实际在途字节数、临时文件清理和进程 RSS，而不只测试合成 limiter。
- [ ] 构造超过 1 MiB 的 status/event，验证 owner 与 follower 间的分页或分块协议、backpressure、超时及错误传播。
- [ ] 并发执行 `listSharedMirrors` 与 mirror 注册，验证新记录不会丢失且共享状态只进行必要的原子写入。
- [ ] 建立至少万级文件/目录的扫描和 rename benchmark，记录 walk、stat、hash、fingerprint 次数及耗时，并设置合理的回归阈值。
- [ ] 为 CLI 和扩展运行同一组共享状态机契约测试，确保相同输入产生相同 status、mutation、冲突和恢复结果。
