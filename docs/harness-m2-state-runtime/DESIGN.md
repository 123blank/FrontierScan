# FrontierScan Harness M2 确定性状态运行时设计

> 日期：2026-07-16
> 分支：`feat/harness-m2-state-runtime`
> 状态：已实现并通过验收

## 1. 目标

将现有 Harness 状态模板和工作流 YAML 升级为可执行、可中断恢复、可审计的单 Story 状态运行时。运行时是阶段推进的唯一权威，Skill 和 Agent 只记录结果与证据，不直接改变阶段。

M2 不实现 Agent Dispatcher、Worktree 并行、真实发布、Git 自动化或 API/UI 验收执行。

## 2. 架构

```text
run-state.ps1
  -> state-runtime.mjs
     -> e2e-development.yaml
     -> e2e-<storyId>.json
     -> e2e-<storyId>.events.jsonl
     -> e2e-<storyId>.lock
     -> active-run.json
```

- PowerShell 只负责稳定的 Windows 命令入口和参数转发。
- Node.js 负责工作流解析、状态校验、门禁、锁、原子写入和恢复。
- 工作流 YAML 是阶段顺序、合法转换和必需产物的权威来源。
- 运行时不引入外部依赖；使用严格的 Harness 工作流 YAML 子集解析器，只接受当前 `phases` 和 `quality_gates` 结构，未知字段形状或缩进直接失败。`quality_gates` 是经过校验的描述性元数据，可执行门禁由 M2 确定性代码实现，不执行自然语言规则。
- 任务状态 JSON 是当前运行事实的权威来源。
- JSONL 事件日志是只追加的审计轨迹。

## 3. 公开命令

```powershell
.\.harness\scripts\run-state.ps1 -Command init -StoryId M2-001 -Summary "实现确定性状态运行时"
.\.harness\scripts\run-state.ps1 -Command status
.\.harness\scripts\run-state.ps1 -Command validate
.\.harness\scripts\run-state.ps1 -Command record -RecordType test -Status passed -Path .harness/reports/test-report.md
.\.harness\scripts\run-state.ps1 -Command next
.\.harness\scripts\run-state.ps1 -Command block -Reason "需要用户确认" -Owner user -SuggestedAction "确认发布范围"
.\.harness\scripts\run-state.ps1 -Command resume
.\.harness\scripts\run-state.ps1 -Command complete
```

通用参数：

- `-StateFile`：显式指定状态文件，优先级高于活动指针。
- `-Json`：输出机器可读 JSON。
- `-Root`：覆盖仓库根目录，默认为脚本所在仓库。

## 4. 活动运行发现

`.harness/states/active-run.json` 只保存指针信息：

```json
{
  "schemaVersion": "1.0",
  "runId": "M2-001",
  "stateFile": ".harness/states/e2e-M2-001.json",
  "status": "active",
  "updatedAt": "2026-07-16T00:00:00.000Z"
}
```

发现规则：

1. 显式 `-StateFile` 始终优先。
2. 未指定时读取 `active-run.json`。
3. 指针缺失、越界、指向不存在文件或标识不一致时停止执行。
4. `complete` 后保留指针并标记 `completed`，不删除审计记录。
5. 新的 `init` 在存在 `active` 或 `blocked` 运行时拒绝执行；目标 Story 的状态、临时文件或备份已存在时也拒绝覆盖。

## 5. 状态扩展

活动 E2E 状态在原模板基础上增加 `runtime`：

```json
{
  "runtime": {
    "runId": "M2-001",
    "workflow": ".harness/workflows/e2e-development.yaml",
    "status": "active",
    "revision": 1,
    "previousPhase": null,
    "blocked": null,
    "records": [],
    "createdAt": "2026-07-16T00:00:00.000Z",
    "updatedAt": "2026-07-16T00:00:00.000Z"
  }
}
```

`records` 元素包含：`id`、`type`、`phase`、`status`、`path`、`message`、`actor`、`createdAt`，绑定文件证据时额外包含 `sha256`。其中 `type` 仅允许 `output`、`test`、`review`、`approval` 和 `note`。

## 6. 阶段推进与门禁

`next` 按以下顺序执行：

1. 验证状态和工作流。
2. 确认当前阶段存在且只声明一个合法下一阶段。
3. 确认当前阶段的所有 `required_outputs` 存在且位于仓库内。
4. 对必需产物记录路径和 SHA-256 证据。
5. 执行阶段质量门禁。
6. 增加 revision，记录事件，原子更新状态和指针。

门禁规则：

- `task-dag`：`.harness/outputs/task-dag.json` 必须通过现有 DAG 校验器。
- `unit-test`：测试记录必须绑定仓库内证据文件；按证据路径保留全部历史记录，但只使用每个路径的最新结果判断门禁；推进时重新校验当前文件 SHA-256。至少存在一条当前 `passed`，且不能存在当前 `failed`。
- `code-review`：不能存在未解决的 `BLOCKER`。
- `build-publish`：纯构建完成后可以推进；M2 不执行真实发布，发布前审批由 `frontier-build-publish` 和项目安全边界负责。
- `git-delivery`：M2 不执行 Git 写操作；`complete` 只检查交付报告与已记录的必要批准。
- 审批记录必须包含 `actor=user`、非空说明、仓库内证据路径及该文件的 SHA-256。同一路径以最新审批结果为准，`denied` 会撤销旧批准；推进时重新计算当前证据哈希，文件变化也会使旧批准失效。运行时校验审计证据完整性，但真实用户身份仍由调用方负责确认。

## 7. 阻塞与恢复

- `block` 保存阻塞前阶段、原因、负责人、建议动作和时间，然后将 `phase` 与 `runtime.status` 设为 `blocked`。
- `resume` 只允许从 `blocked` 恢复，恢复到阻塞前阶段并保留阻塞记录。
- 普通测试失败或审核问题不自动转为 `blocked`；门禁拒绝推进后保持当前阶段。

## 8. 锁和原子写入

- 更新命令使用 `open(..., "wx")` 创建独占 `.lock`。
- 锁内记录 PID、主机名和创建时间，运行结束时在 `finally` 中释放。
- 仅当锁超过配置的过期时间且持有进程不存在时才回收旧锁。
- 单个状态文件先写入 `.tmp` 并同步，再将原文件转为 `.bak`，最后提升 `.tmp`。
- 读取时在正式状态损坏或缺失时，从有效 `.tmp` 和 `.bak` 中选择 revision 最高者恢复。
- 跨状态与指针的一次更新按 `intent -> stage pointer.tmp -> commit state -> promote pointer.tmp -> committed` 执行，避免状态提交后没有可恢复的新指针。
- 指针恢复会同时核对目标状态：`pointer.tmp` 领先状态时视为尚未提交并回退正式指针，状态已达到其 revision 时才恢复该临时指针；正式指针领先状态仍失败关闭，状态领先正式指针则派生当前 revision 和 status。
- 跨 Story 候选不能直接比较 revision；有效 `.tmp` 代表当前写入事务，否则以正式指针的 `runId/stateFile` 约束候选身份。
- 初始化同样读取可恢复指针；任一候选恢复出 `active` 或 `blocked` 时拒绝创建第二个活动运行。
- 新 Story 初始化在全局初始化锁内发现旧运行已完成时，必须再获取旧 Story 锁并重新读取状态；确认仍为 `completed` 后先对账旧事件日志，再替换活动指针。
- 恢复时如发现没有结束事件的 `intent`，则对比当前 revision：状态已提交时补记 `committed`，未提交时记录 `aborted`。
- 同一 run/revision 已被后续事务提交时，较早的孤立 `intent` 记录为 `aborted`；没有正式 `committed` 尾事件时，也只有最后一个孤立 intent 能由当前状态证明为 `committed`，避免初始化重试产生两个已提交事务。
- 完成态写命令仍先在锁内执行事件对账，再拒绝修改状态，保证终态 revision 不变且事务日志闭合。

## 9. 错误处理

- 无效参数、指针损坏、状态不一致、非法转换、缺少产物和门禁失败均以非零退出。
- 错误信息必须包含可执行的修复方向，但不包含密钥或外部敏感信息。
- 任何校验失败都不得修改阶段或 revision。
- `status` 和 `validate` 是只读命令，不获取写锁。
- `completed` 状态是不可变终态，所有更新命令均失败关闭。

## 10. 测试设计

使用 Node.js 临时仓库 Fixture 实施 TDD，覆盖：

1. `init` 创建任务状态、事件日志和活动指针，不修改模板。
2. 新进程仅通过指针恢复运行。
3. 合法转换成功，越级或未声明转换失败。
4. 缺少必需产物时 revision 和阶段不变。
5. DAG、测试、BLOCKER、发布批准和交付门禁生效。
6. `block` 和 `resume` 保留完整事件顺序。
7. 两个并发更新不能同时成功。
8. 正式文件损坏时能从高 revision 的临时或备份恢复。
9. PowerShell 入口传参与 Node.js 退出码传递正确。
10. 结构校验、状态校验和 Harness 冒烟流程保持通过。
11. 失败测试在同一证据路径重跑通过后可以推进，同时保留原失败记录。
12. 完成态拒绝继续写入，重复 `init` 不覆盖已有 Story 状态。
13. 缺少说明、证据路径、哈希或 `actor=user` 的审批不能通过门禁。
14. 测试证据文件在记录后发生变化时不能推进，重新记录当前内容后才恢复。
15. 纯构建无需审批即可推进；真实发布仍不得由 M2 执行。
16. 完成态孤立事务先补记终结事件，再拒绝状态修改。
17. 仅存在 `.tmp/.bak` 活动指针时拒绝重复初始化，跨 Story 旧备份不遮蔽新运行。
18. 指针领先状态时默认和显式入口都失败，状态领先指针仍可恢复。
19. 普通 `status` 拒绝非法 runtime，初始化拒绝契约无效的可恢复指针。
20. 同 revision 初始化重试时，失败的早期 intent 记为 `aborted`；即使成功重试也缺少 committed 尾事件，也只能补记最后一个孤立 intent 为 `committed`。
21. 指针暂存后、状态提交后和指针提升前的中断都可确定性恢复，跨 Story 初始化不会丢失已提交状态。
22. `complete` 在状态提交后中断时，新 Story 初始化先闭合旧事务；仍在执行的 `complete` 持有 Story 锁时，并发初始化失败且可在完成后重试。

## 11. 文件边界

计划新增：

- `.harness/scripts/run-state.ps1`
- `.harness/scripts/lib/state-runtime.mjs`
- `.harness/scripts/tests/state-runtime.test.mjs`
- `.harness/schemas/active-run.schema.json`
- `docs/harness-m2-state-runtime/PLAN.md`
- `docs/harness-m2-state-runtime/REPORT.md`

计划修改：

- `.harness/schemas/e2e-state.schema.json`
- `.harness/structure-manifest.yaml`
- `.harness/scripts/smoke-harness-flow.ps1`
- `.codex/skills/frontier-state-runner/SKILL.md`
- `.codex/skills/skill-registry.yaml`
- `docs/AI-handover.md`
- 知识基线与本地索引产物

不修改 `backend/src/**` 或 `frontend/src/**`。

## 12. 验收标准

1. 任意阶段停止后，新进程可从同一状态继续。
2. 非法转换、缺失产物、失败测试和未解决 BLOCKER 都不能推进。
3. 并发更新不能损坏状态，中断写入可恢复。
4. 批准和证据路径持久化，不依赖对话历史。
5. 模板保持不变，业务源码保持不变。
