---
name: frontier-state-runner
description: 管理、校验、恢复和推进 FrontierScan Harness 状态。单 Story 需要跨会话保存阶段、证据、测试、审核、阻塞或交付状态时使用。
---

# Frontier 状态运行器

当工作流进度需要跨会话保存时使用本 Skill。E2E 活动状态必须通过确定性运行时修改，不得手工改写阶段或 revision。

## 快速流程

1. 初始化单 Story 运行：

```powershell
.\.harness\scripts\run-state.ps1 -Command init -StoryId M2-001 -Summary "业务摘要"
```

2. 每次继续工作前读取并校验状态：

```powershell
.\.harness\scripts\run-state.ps1 -Command status -Json
.\.harness\scripts\run-state.ps1 -Command validate
```

3. 完成当前阶段要求的工作，通过 `record` 保存测试、审核、批准或说明证据。
4. 使用 `next` 推进一个阶段；缺少产物或门禁失败时停留在原阶段。
5. 需要外部决策时使用 `block`，问题解决后使用 `resume`。
6. 只有 `git-delivery` 阶段可以使用 `complete` 进入 `done`。

## 常用命令

```powershell
.\.harness\scripts\run-state.ps1 -Command record -RecordType test -Status passed -Path .harness/reports/test-report.md
.\.harness\scripts\run-state.ps1 -Command record -RecordType approval -Status approved -Actor user -Message "批准发布或 Git 交付" -Path .harness/reports/delivery-report.md
.\.harness\scripts\run-state.ps1 -Command next
.\.harness\scripts\run-state.ps1 -Command block -Reason "需要确认" -Owner user -SuggestedAction "确认范围"
.\.harness\scripts\run-state.ps1 -Command resume
.\.harness\scripts\run-state.ps1 -Command complete
```

通用参数：`-StateFile` 显式选择状态，`-Root` 指定仓库根目录，`-Json` 输出机器可读结果。

## 状态文件

- `.harness/states/active-run.json`：当前单 Story 活动指针。
- `.harness/states/e2e-<storyId>.json`：当前事实状态。
- `.harness/states/e2e-<storyId>.events.jsonl`：只追加审计事件。
- `.harness/states/e2e-state.template.json`：初始化模板，不作为活动状态直接编辑。
- `.harness/states/product-state.template.json`：产品级拆分模板；M2 尚未实现产品级运行时。

## 参考资料

- 决定当前或下一阶段前读取 `references/phase-model.md`。
- 创建或修改状态记录前读取 `references/state-update-rules.md`。

## 规则

- 状态文件是事实来源，对话历史不是。
- 只通过 `run-state.ps1` 更新 E2E 活动状态。
- `-StateFile` 可独立读取或更新指定状态；只有目标与活动指针一致时才更新活动指针。
- 不得越过失败的质量门禁。
- 纯构建可以离开 `build-publish`；任何真实发布仍必须在执行前通过 `frontier-build-publish` 获取显式用户批准。
- 完成 `git-delivery` 前，必须记录当前阶段的显式用户批准。
- 测试跳过、环境不可用和审核阻塞都必须记录。
- 未经用户明确批准且没有证据，不得将发布、提交、推送或合并标记为完成。
- 审批记录必须包含 `actor=user`、非空说明和仓库内证据文件；运行时保存证据文件 SHA-256，但调用方仍负责确认真实用户身份。
- 测试记录必须绑定仓库内证据文件；同一路径重跑时以最新结果判断门禁，历史记录继续保留。
- 测试证据文件变化后旧结果失效，必须对当前内容重新记录测试结果。
- 审批证据文件变化后旧批准失效，必须对当前内容重新记录批准。
- 同一证据路径以最新审批结果为准，`denied` 会撤销此前的 `approved`。
- 已完成运行不可再修改，已存在的 Story 状态不可通过重复 `init` 覆盖。
- 完成态写命令会先对账孤立事务事件，再拒绝状态修改。
- 新 Story 初始化发现旧运行已完成时，会按 `active-run.lock -> completed Story lock` 的顺序重新读取并闭合旧事务；仍在执行的完成操作会使初始化明确失败，释放锁后可重试。
- 初始化会检查正式指针、`.tmp` 和 `.bak`；任一候选恢复出活动或阻塞运行时不得创建第二个活动运行。
- 更新按 `pointer stage -> state commit -> pointer promote` 提交；临时指针领先状态时回退正式指针，状态达到临时指针 revision 后才恢复它。
- 跨 Story 指针候选按当前原子写入身份恢复；正式指针 revision 领先状态时失败关闭，状态领先指针可以按写入顺序恢复。
- 默认指针和已有运行状态必须通过运行时契约校验；显式 `-StateFile` 仍可在无关活动指针损坏时独立使用。
- M2 不负责 Agent 自动派发、Worktree 并行、真实发布或 Git 自动写入。
