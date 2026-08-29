# LaTeX Editing Toolkit TODO

以下仅保留尚未完成的 Remote-SSH / Local Notes 隔离事项。完成一项后再勾选并补充回归测试。

## P1：Remote-SSH 状态隔离与隐私

- [x] **按 Remote-SSH authority 隔离 Local Notes 注册表**
  - 涉及：`src/projectRegistry.ts`、`src/extension.ts` 的 `context.globalState` 使用。
  - 当前 `latexEditingToolkit.localProjects` 是扩展级全局 key，没有 machine/remote authority 命名空间；共享 home、Profile 恢复或远端环境迁移时，其他主机创建的项目名和绝对路径可能显示为 `Missing`。
  - 使用 `vscode.env.remoteName`、受控机器标识和版本化 key 做隔离；旧版未命名空间 key 默认不导入，避免把未知主机路径直接带入当前环境。
  - 验收：本地窗口、不同 Remote-SSH 主机、容器和 Codespaces 之间互不显示注册表；迁移测试覆盖旧 key、共享 home 和路径不存在场景。

- [x] **限制 Local Notes 的路径元数据暴露**
  - 涉及：`src/extension.ts` 的 `localProjectNode()`、TreeItem `tooltip`、`resourceUri` 和 `commandArgs`。
  - 当前节点会把绝对路径放入 tooltip、URI 和命令参数；在共享屏幕、导出的 UI 状态或诊断数据中可能暴露用户名、目录结构和项目名称。
  - 默认仅显示项目名/相对父目录，完整路径只在用户主动查看时显示；命令执行前重新校验当前 authority 与路径归属，避免把远端路径交给本地窗口处理。
  - 验收：普通渲染和复制诊断不包含绝对路径；显式“显示路径”仍可用；跨 authority 打开路径会被拒绝并给出恢复动作。

- [x] **限制和清理跨环境遗留的 Local Notes 条目**
  - 涉及：`src/projectRegistry.ts` 的 `readCleanEntries()`、`list()`。
  - 当前会永久保留不存在的项目，只要全局状态仍存在就持续显示 `Missing`；条目数量、label、rootPath 长度也没有明确上限。
  - 增加条目数量/字段长度上限、过期条目保留策略和“清理全部 Missing”命令；清理前显示将删除的元数据数量，不删除实际文件。
  - 验收：异常/超大状态被安全丢弃或 quarantine；长期不存在的条目按策略清理；清理只影响当前 authority。

- [x] **隔离 Create Project 最近路径历史**
  - 涉及：`src/extension.ts` 的 `RECENT_PROJECT_PARENTS_KEY`。
  - 最近创建目录同样以全局 key 保存绝对路径，可能跨 Remote-SSH 环境出现在创建向导中；需要与 Local Notes 使用同一 authority 命名空间和脱敏显示策略。
  - 验收：不同主机/容器不会互相显示最近目录；旧版未命名空间历史默认不导入，并有隔离回归测试。
