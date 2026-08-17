# Overleaf Codex TODO

本清单来自 2026-08-16 对当前 Overleaf 实现的第二轮稳定性与性能审查。旧清单中已经完成的历史事项已移除；只有实现并通过回归测试的项目才勾选。

## P0 — 正确性与数据安全

- [x] 修复 CLI 对远端非空目录 rename/move 的处理顺序；整个子树只移动一次，目标冲突时不得覆盖本地内容，manifest 写入失败时必须回滚本地路径和内存状态。
- [x] 将二进制替换恢复改为基于远端 entity ID 与实际名称的幂等恢复，覆盖“远端操作成功、事务 stage 尚未落盘”两个崩溃窗口。
- [x] 将完整 `syncOnce` reconcile 串行化，并串行执行 owner IPC 命令；停止 watcher 时等待整个在途 reconcile，禁止停止过程中重新建立连接。

## P1 — 稳定性

- [x] 让目录状态同时比较 manifest、远端树和真实本地目录，正确报告及同步新建/删除的空目录。
- [x] CLI 遇到远端读取失败时将 status 标记为 `partial`，与扩展行为保持一致。
- [x] 扩展停止同步时等待所有 path operation 和活动 health check，再释放 owner 锁。
- [x] 修复 owner socket 启动失败后的假 owner 状态，并为 IPC frame、发送队列和 backpressure 设置边界。
- [x] 为共享配置锁加入进程启动时间校验，并使 reclaim guard 的失效时间不超过调用方等待时间。
- [x] 为远端编译增加单写者锁和崩溃恢复，避免 CLI、手动编译及 compile-on-save 并发交换 output。
- [x] 为 manifest、conflict、transaction、sync-status 和共享配置增加 schema 校验、损坏文件隔离及可诊断恢复。

## P2 — 性能与去重

- [x] 合并本地文件/目录扫描为一次 walk，预建 tracked-parent、entity ID、hash 和 folder fingerprint 索引，消除大项目中的 O(n²) 查找及重复扫描。
- [x] 二进制上传/下载改为临时文件流式 I/O 和增量 hash，并按任务数与在途字节数双重限制并发。
- [x] 在远端读取计划阶段过滤 ignore；CLI watcher 同时应用 `.overleaf-codexignore`，避免本地编译产物触发无效全量 reconcile。
- [x] 将 CLI `OverleafSyncEngine` 与扩展 `RealtimeSyncService` 的 check、rename、push/pull、冲突及二进制流程下沉为同一套共享状态机。
- [x] `mirrors list` 批量刷新共享状态，只在内容变化时执行一次原子写入。
- [x] 对文本 `joinDoc` 使用受控并发，并在只读检查后释放不需要长期订阅的文档。

## 回归测试

- [x] 覆盖远端非空目录 rename/move、嵌套目录、目标已存在和 manifest 写入失败回滚。
- [x] 在每个二进制远端 mutation 与事务 stage 写入之间注入崩溃，验证恢复幂等且不会丢失正式文件。
- [x] 并发启动多个 `syncOnce`、push/pull 和 owner IPC 请求，验证没有重复远端 mutation 或 manifest 交错写入。
- [x] 覆盖 stop、SIGINT/SIGTERM、owner 交接期间的在途 reconcile 排空。
- [x] 增加大型目录树、大图片/PDF 和本地连续编译事件的性能基准。
