# Frontier State 更新规则

## 创建

新 Story 只能通过确定性入口初始化：

```powershell
.\.harness\scripts\run-state.ps1 -Command init -StoryId <story-id> -Summary "<摘要>"
```

初始化默认使用 State v2，并要求：

- 当前目录是 Git 仓库根目录。
- `HEAD` 已提交且分支处于 attached 状态。
- 初始化期间 HEAD 和 branch 不发生变化。
- Runtime 冻结 HEAD、branch 和初始 dirty paths。

不要复制模板后手工创建活动 State。历史 v1 State 不迁移、不补写。

## 更新纪律

- 活动 State 只能通过 `run-state.ps1` 修改。
- State v1 只允许 `status` 和 `validate`。
- 模板和 completed State 不可修改。
- 阶段、revision、指针和事件必须由 Runtime 原子更新。
- State v2 的结构化阶段事实只能由严格 `result.json` 经 `run-story.ps1 apply` 投影，不能通过 `record` 或手工编辑回填。
- `runtime.records[type=phase-result]` 是已应用结果的正式索引；过程 checkpoint 或 `active-attempt.json` 丢失时按正式索引恢复。
- `acceptance` 是 requirement、DAG、测试、验证和 approval 的派生汇总；每阶段 apply 与最终 completion 都重新计算，不接受手工缓存漂移。
- `accepted-with-known-gaps` 必须先通过 `run-story.ps1 approve-gap` 写入 attempt-scoped receipt；批准不会单独修改 State revision。
- 外部环境不可用时记录真实阻塞或缺口，不得伪造验证通过。

## 推进

推进前必须：

1. 校验 State 与版本化 workflow 绑定。
2. 确认当前阶段 required outputs 存在。
3. 确认当前质量门禁通过。
4. v2 使用 `run-story.ps1 apply` 推进普通阶段。
5. v2 的 `delivery-preparation` completed result 通过 completion gate 后直接进入 `done`。

v2 的 `delivery-preparation -> done` 表示交付准备完成，不表示 Git 提交或推送已经发生。

## 阻塞

`block` 将当前阶段保存到 `runtime.activeBlock.previousPhase`，并写入理由、Owner、建议动作和时间。

`resume` 恢复原阶段并将 `runtime.activeBlock` 清空。历史阻塞保留在 `logs` 和事件文件中。

普通测试失败或审核问题已有明确修复动作时，不应滥用 `blocked`。

`failed` result 不改变 State；`blocked` result 使用一次事务进入 blocked，并保留旧 attempt。`resume` 后重新 prepare 必须创建绑定新 revision 的 dispatchId。
