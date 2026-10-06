# FrontierScan Harness M7-A1 实施报告

> 日期：2026-08-12
>
> 状态：实现、fixture 验证与独立只读审核完成
>
> 设计：`docs/harness-m7a1-state-v2/DESIGN.md`
>
> 计划：`docs/harness-m7a1-state-v2/PLAN.md`

## 1. 实施摘要

本次完成 M7-A1 State v2 契约与版本共存：

- 新 Story 默认使用 `e2e-state-v2.template.json` 和 `e2e-development-v2.yaml`。
- State v1 保留 `status`、`validate` 和审计读取，所有写命令失败关闭。
- 新增单一 Node 契约 `state-contract.mjs`，PowerShell 校验器改为薄入口。
- v2 初始化冻结 Git HEAD、branch 和初始 dirty paths。
- workflow 顶层版本、模板路径和 State 版本绑定，漂移时失败关闭。
- v2 阻塞使用 `runtime.activeBlock`，恢复后清空，历史留在日志和事件中。
- v2 从 `delivery-preparation` 完成到 `done`，不要求 Git 批准，也不执行 Git。
- Story Runtime 根据 workflow 的 `next=done` 选择 `complete`，不再硬编码 `git-delivery`。

## 2. TDD 证据

实施按 RED-GREEN 推进，主要 RED 包括：

| RED | 原因 | GREEN |
| --- | --- | --- |
| `ERR_MODULE_NOT_FOUND: state-contract.mjs` | 缺少单一契约模块 | 新增契约并通过版本、结构和命令能力测试 |
| v2 模板不存在 | 缺少 Schema、模板和 workflow | 新增 v2 资产并纳入结构校验 |
| init 仍生成 v1 | 默认初始化未切换 | init 默认生成 v2 并冻结 Git baseline |
| `runtime.blocked` 被 v2 契约拒绝 | 阻塞语义仍为 v1 | 改为 `activeBlock`，resume 后清空 |
| complete 固定要求 `git-delivery` | 旧完成语义硬编码 | 按当前 workflow 的 `next=done` 完成 |
| PowerShell 要求顶层 `tasks` | Node/PowerShell 双契约漂移 | PowerShell 改为 Node 契约薄入口 |
| workflow metadata 返回 `undefined` | parser 丢弃顶层版本信息 | 保存并校验 `schema_version/state_file` |
| Story 最终阶段调用 `next` | Dispatcher 硬编码阶段名 | 根据 `phase.next.includes("done")` 选择 `complete` |
| smoke 临时目录无法 init | 无 Git baseline 且缺 v2 资产 | 初始化临时 Git 并复制 v1/v2 资产 |

## 3. 验收映射

| 验收项 | 结果 | 证据 |
| --- | --- | --- |
| AC-A1-01 新 Story 默认 v2 | 通过 | State Runtime init 测试、smoke |
| AC-A1-02 v1 只读兼容 | 通过 | v1 `status/validate` 与写命令拒绝测试 |
| AC-A1-03 版本失败关闭 | 通过 | 未知版本、混合字段、workflow 漂移测试 |
| AC-A1-04 DAG 唯一任务入口 | 通过 | v2 模板无顶层 `tasks`，严格契约测试 |
| AC-A1-05 `activeBlock` | 通过 | block/resume、日志和事件测试 |
| AC-A1-06 Git baseline | 通过 | clean/dirty/rename/parser 与初始化 fixture |
| AC-A1-07 完成语义 | 通过 | v2 九阶段闭环，无 Git approval 完成 |
| AC-A1-08 单一契约 | 通过 | Node 与 PowerShell validator 一致性测试 |

## 4. 兼容与边界

- `.harness/states/e2e-M6-A-001.json` 和对应事件文件未修改。
- M5 batch/worktree 正式 Runtime 仍使用其历史 v1 协议；A1 不宣称这些 Runtime 已支持正式 v2 State。
- Worker 基础纵向 fixture 已支持默认 v2 Story。
- dispatch task/result 协议仍为现有 `1.0/1.1/1.2`，未在 A1 升级。
- 阶段结构化 result 投影、验收追踪、知识 freshness 门禁、owned files 推导和 delivery receipt 未提前实现。

## 5. 验证结果

已通过：

```text
node .\.harness\scripts\tests\state-runtime.test.mjs
node .\.harness\scripts\tests\story-runtime.test.mjs
node .\.harness\scripts\tests\worker-runtime.test.mjs
node .\.harness\scripts\tests\batch-runtime.test.mjs
node .\.harness\scripts\tests\serial-batch-runtime.test.mjs
node .\.harness\scripts\tests\worktree-runtime.test.mjs
node .\.harness\scripts\tests\worktree-integration-runtime.test.mjs
node .\.harness\scripts\tests\worktree-worker-runtime.test.mjs
node .\.harness\scripts\tests\worktree-wave-runtime.test.mjs
node .\.harness\scripts\tests\worktree-wave-execution-runtime.test.mjs
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.harness\scripts\smoke-harness-flow.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.harness\scripts\validate-structure.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.harness\scripts\validate-state.ps1 -StateFile .\.harness\states\e2e-M6-A-001.json
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.harness\scripts\validate-state.ps1 -StateFile .\.harness\states\e2e-state-v2.template.json
git diff --check
```

关键计数：

- `batch-runtime`: 32/32。
- `worktree-runtime`: 28/28。
- `worktree-integration-runtime`: 44/44。
- `worktree-worker-runtime`: 97/97。
- `worktree-wave-runtime`: 35/35。
- `worktree-wave-execution-runtime`: 9/9。
- 结构校验检查 33 个目录、226 个文件和 13 个 Skill。

M5 正式 Runtime 仍只接受 v1 State。原来依赖“v1 M5 工件完成后继续由 M3 apply 写 v1 State”的测试已改为：

- 验证 v1 写入明确拒绝且 State 不变。
- 回收测试使用完整的历史 completed v1 State、事件、备份、阶段输出和记录哈希。

这保持了 M5 协议与回收安全回归，同时没有放宽 A1 的 v1 只读边界。

历史 M6-A State 和事件文件属于被 Git 忽略的运行态资产，当前 HEAD 不包含对应 blob，无法使用 `HEAD:<path>` 做对比。实施期间未编辑这两个文件，`git status` 和任务 diff 也未包含它们；当前 Git blob 哈希为：

```text
.harness/states/e2e-M6-A-001.json
f81d92ddd2eb81a1d796c6a6432e819fecd616aa

.harness/states/e2e-M6-A-001.events.jsonl
101e7e39ddb52a286057d9e92d8fe35a696a55ec
```

## 6. 知识状态

2026-08-12 smoke 中的 freshness 检查仍报告 backend、frontend、common 为 `stale-or-incomplete`。本次直接核验 Harness 源码完成实现；将 freshness 写入 State 并形成门禁属于 M7-C，不在 A1 中伪装为已完成。

## 7. 外部操作

本次未执行：

- Git 暂存、提交或推送。
- Worktree 创建、删除或清理。
- Docker、发布或部署。
- 生产环境或外部服务写操作。

## 8. 独立审核

首次独立只读审核发现 2 个 BLOCKER 和 2 个 WARNING：

1. v2 phase/status 缺少双向一致性约束。
2. 已确认的 acceptance criterion、knowledge area 和 v2 record item 未禁止额外字段。
3. active pointer 未固定 `schemaVersion="1.0"`。
4. Git baseline 自动测试矩阵不完整。

已按 TDD 关闭：

- 增加 template、active、blocked、completed 与 phase 的双向 Node/Schema 约束。
- 为 acceptance criterion、knowledge area 和 v2 record 建立严格 item 结构，不启用 A2/A3/C 的语义门禁。
- active pointer Node/Schema 均固定为 `1.0`。
- 新增 staged、unstaged、untracked、rename、copy、detached、unborn、HEAD/branch 漂移、Git status 失败和零持久化测试。
- 保持 v1 record 的历史宽松兼容，额外字段拒绝只作用于 v2。
- 同步更新 manifest 的 M7-A1 实施状态。

修复后重新通过：

```text
node .\.harness\scripts\tests\state-runtime.test.mjs
node .\.harness\scripts\tests\story-runtime.test.mjs
node .\.harness\scripts\tests\worker-runtime.test.mjs
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.harness\scripts\smoke-harness-flow.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.harness\scripts\validate-structure.ps1
git diff --check
```

第二次独立复审发现 1 个 BLOCKER：

- `runtime.activeBlock.previousPhase` 只要求非空字符串，可能使 `resume` 从契约合法输入持久化出非法 phase/status 组合。

已按 TDD 关闭：

- Node 契约与 JSON Schema 将 `activeBlock.previousPhase` 限制为 v2 活动阶段，明确排除 `done`、`blocked` 和未知值。
- `persistLocated` 在写 intent 前统一校验待写 State；匹配的 active pointer 在实际写入前也经过契约校验。
- 增加 `nonsense`、`done`、`blocked` 三类负例，以及非法 resume 拒绝后 State 和 events 字节不变的零写入测试。

最终复审未发现剩余 BLOCKER/WARNING，并确认：

- 所有普通写路径均汇入统一写前契约校验。
- v1 历史兼容与只读边界未被放宽。
- 未提前实现 A2、A3、A4 或 M7-C，也未引入自动 Git 或外部副作用。

最终验证期间，`state-runtime` 在 Windows 临时 Git fixture 清理时连续出现 `EBUSY`。断言和运行时行为均已执行完成，根因是测试直接使用 `fs.rm` 的零重试默认值。测试基础设施增加有限重试后完整通过，未修改生产 Runtime 语义。

最终审核结论：通过，无剩余 BLOCKER/WARNING。
