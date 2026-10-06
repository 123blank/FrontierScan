# FrontierScan Harness M2 确定性状态运行时实施报告

> 日期：2026-07-16
> 分支：`feat/harness-m2-state-runtime`
> 范围：单 Story 状态初始化、定位、校验、记录、推进、阻塞、恢复和完成
> 结论：实现完成，等待用户决定提交与集成方式

## 1. 交付能力

M2 将原有状态模板和工作流 YAML 升级为可执行的单 Story 确定性运行时：

```text
run-state.ps1
  -> state-runtime.mjs
     -> e2e-development.yaml
     -> e2e-<storyId>.json
     -> e2e-<storyId>.events.jsonl
     -> e2e-<storyId>.lock
     -> active-run.json
```

公开命令包括：

```powershell
.\.harness\scripts\run-state.ps1 -Command init -StoryId M2-001 -Summary "业务摘要"
.\.harness\scripts\run-state.ps1 -Command status -Json
.\.harness\scripts\run-state.ps1 -Command validate
.\.harness\scripts\run-state.ps1 -Command record -RecordType test -Status passed -Path .harness/reports/test-report.md
.\.harness\scripts\run-state.ps1 -Command next
.\.harness\scripts\run-state.ps1 -Command block -Reason "需要确认" -Owner user -SuggestedAction "确认范围"
.\.harness\scripts\run-state.ps1 -Command resume
.\.harness\scripts\run-state.ps1 -Command complete
```

## 2. 核心实现

- 活动指针：`.harness/states/active-run.json` 定位唯一活动运行，显式 `-StateFile` 可覆盖指针。
- 工作流驱动：严格解析 `e2e-development.yaml` 的阶段、顺序、下一阶段、必需产物和质量门禁。
- 证据门禁：必需产物记录仓库相对路径和 SHA-256；失败测试、未解决 `BLOCKER` 和无效 DAG 阻止推进。
- 状态操作：支持 `record/block/resume/complete`，普通 `next` 不能直接进入 `done`。
- 并发保护：更新命令使用独占锁，锁内重新读取最新状态，避免两个进程同时写入。
- 中断恢复：状态和指针使用 `.tmp/.bak` 原子写入，读取时选择最高有效 revision。
- 事务审计：每次更新写入 `intent/committed`；下次写操作会把孤立 `intent` 对账为 `committed` 或 `aborted`。
- 稳定入口：PowerShell 只做参数转发并保留 Node.js 非零退出码，`-Json` 支持机器消费。

## 3. TDD 证据

| 能力 | 观察到的 RED | GREEN 结果 |
| --- | --- | --- |
| 初始化与定位 | 核心模块或命令缺失 | 模板深拷贝、活动指针、重复运行保护通过 |
| 工作流推进 | 缺少解析与产物门禁 | 合法单步转换、路径边界和 SHA-256 证据通过 |
| 记录与质量门禁 | `record/block/resume/complete` 缺失 | 测试、审核、DAG、阻塞恢复和完成门禁通过 |
| 并发与恢复 | 锁竞争和损坏状态无法恢复 | 独占锁、高 revision 恢复、事务事件顺序通过 |
| 孤立事务对账 | 找不到预期 `aborted` 事件 | 未提交 intent 自动补记 `aborted`，已提交事务可补记 `committed` |
| PowerShell 入口 | `run-state.ps1` 不存在 | 成功命令退出 0，门禁失败保留非零退出码 |
| 状态契约 | 缺少 `runtime` 的活动状态仍被接受 | Schema、模板和 PowerShell 校验器统一要求运行时元数据 |
| Harness 集成 | 新 Schema 未登记在结构清单 | 结构、Skill 注册和临时运行时冒烟通过 |

## 4. 结构与契约变化

- 新增 `.harness/scripts/run-state.ps1` 和 `.harness/scripts/lib/state-runtime.mjs`。
- 新增 `.harness/schemas/active-run.schema.json`，扩展 `e2e-state.schema.json` 的 `runtime` 契约。
- E2E 模板使用 `status: template`、`revision: 0`；初始化后切换为 `active`、`revision: 1`。
- `frontier-state-runner` 已从指导文档升级为 `implemented-v1`，活动状态禁止手工推进。
- 冒烟流程在系统临时目录执行 `init/status/validate`，结束后删除临时目录，不污染仓库。

## 5. 验证范围

最终验收覆盖：

- 状态运行时单元与集成测试。
- 既有源指纹、知识状态、知识生成、查询与新鲜度回归。
- 状态模板、DAG、结构清单和完整 Harness 冒烟。
- `git diff --check` 与业务源码零改动审计。

实际命令与最终结果见本报告第 7 节和交接文档最新章节。

## 6. 安全边界

- 未修改 `backend/src/**` 或 `frontend/src/**`。
- 未实现或执行 Agent 自动派发、Worktree 创建/合并、真实发布、部署或 Git 自动写入。
- 未读取、打印或调用 API 密钥。
- 未自动暂存、提交、推送或合并。
- 状态运行时只允许仓库内相对状态、证据和工作流路径。

## 7. 最终验收结果

| 验收项 | 结果 |
| --- | --- |
| 状态运行时回归 | 通过 |
| 源指纹回归 | 通过 |
| Harness 状态回归 | 通过 |
| 知识生成回归 | 通过 |
| 知识查询回归 | 通过 |
| 知识新鲜度回归 | 通过 |
| 结构校验 | 通过：17 个目录、109 个文件、13 个 Skill |
| 完整 Harness 冒烟 | 通过，临时运行状态已清理 |
| 知识基线与索引 | 14 个模块、125 个写入文件、328 个 Chunk |
| 知识新鲜度 | backend、frontend、common 均为 Baseline/Index `fresh` |
| 语义与 Embedding | Semantic `pending`，Embedding `skipped` |
| `git diff --check` | 通过，仅有 Windows 行尾提示 |
| 业务源码审计 | `backend/src/**`、`frontend/src/**` 差异为空 |

主要验证命令：

```powershell
node .\.harness\scripts\tests\state-runtime.test.mjs
node .\.harness\scripts\tests\source-fingerprint.test.mjs
node .\.harness\scripts\tests\harness-status.test.mjs
node .\.harness\scripts\tests\generate-kb.test.mjs
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.harness\scripts\tests\kb-query.test.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.harness\scripts\tests\kb-freshness.test.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.harness\scripts\validate-structure.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.harness\scripts\smoke-harness-flow.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.harness\scripts\check-kb-freshness.ps1
git diff --check
git status --short -- backend/src frontend/src
```

## 8. 后续工作

下一独立里程碑建议进入 M3 Agent Dispatcher：先定义结构化 Agent 输入/输出、权限和失败恢复，再接入状态运行时。M3 不应绕过 M2 门禁，也不应同时引入 Worktree 并行和真实发布。

## 9. 审核跟进修复

本轮代码审核发现并修复 3 个状态运行时可靠性问题：

- 显式 `-StateFile` 现在独立于活动指针加载；指针缺失或损坏不再阻断指定状态读取，操作非活动状态也不会改写其他运行的活动指针。
- JSONL 最后一行因进程中断而不完整时，运行时按 UTF-8 字节边界截除该尾部后继续对账；中间损坏或已换行的非法事件仍失败关闭。
- `build-publish` 和 `git-delivery` 增加显式审批门禁，只接受当前阶段 `approval/approved/actor=user` 记录。

新增测试均先观察到对应 RED，再完成最小实现并恢复全量 GREEN。

### 9.1 二次审核修复

二次审核继续发现并修复 4 个主流程问题：

- 测试记录必须绑定仓库内证据文件；`unit-test` 门禁按证据路径读取最新结果，同一报告从 `failed` 重跑为 `passed` 后可以推进，历史失败记录仍保留。
- `completed` 成为不可变终态，所有更新命令在锁内读取最新状态后统一拒绝写入。
- `init` 在目标 Story 的正式状态、`.tmp` 或 `.bak` 已存在时拒绝覆盖，避免 revision 重置和审计记录丢失。
- 审批记录必须包含 `actor=user`、非空说明和仓库内证据文件，并保存 SHA-256；同一路径的 `denied` 撤销旧批准，推进时重新计算当前哈希，证据变化后也必须重新批准。运行时保证证据完整性，真实用户身份仍由调用方负责确认。

4 组原始审核回归与 3 个复审边界均先观察到对应 RED，再完成最小修复并恢复状态运行时测试 GREEN。最终状态测试、源指纹、Harness 状态、知识生成、知识查询、知识新鲜度、结构校验、状态校验、完整 Harness 冒烟和 `git diff --check` 均退出 0；业务源码差异为空。

### 9.2 三次审核修复

三次审核继续修复 3 个门禁与审计问题：

- `unit-test` 推进时重新计算最新测试证据的 SHA-256；报告在记录后变化会使旧结果失效。
- 纯构建无需状态内审批即可从 `build-publish` 推进；M2 不执行发布，真实发布继续由 `frontier-build-publish` 和项目安全边界在执行前审批。
- 完成态写命令先在锁内对账孤立 `intent`，再拒绝状态修改，保持终态 revision 不变并补齐事务终结事件。

`quality_gates` 保留为严格解析和校验的描述性元数据，可执行门禁继续由 M2 确定性代码实现。

上述修复完成后重新执行状态运行时、源指纹、Harness 状态、知识生成、知识查询、知识新鲜度、结构、状态模板和完整冒烟验证，所有命令均退出 0；`git diff --check` 仅报告 Windows 行尾提示，业务源码差异为空。

### 9.3 四次审核恢复一致性修复

完成审计继续修复 4 组恢复与审计问题：

- `init` 与普通定位统一读取正式指针、`.tmp` 和 `.bak`；可恢复的 `active/blocked` 指针不能被新运行覆盖。
- 跨 Story 指针替换按当前 `.tmp` 或正式指针的 `runId/stateFile` 约束候选身份，旧 Story 的高 revision 备份不会遮蔽新运行；两个原子替换中断窗口均有回归测试。
- 指针 revision 领先可恢复状态时默认和显式入口均失败关闭，避免从旧状态复用 revision；所有已有运行命令校验 runtime，初始化和默认定位校验活动指针契约。
- 初始化在首个 intent 后中断并以同一 Story 重试时，后续同 revision 提交会把较早孤立 intent 对账为 `aborted`；若成功重试也缺少 committed 尾事件，则只有最后一个孤立 intent 补记 `committed`。完成态缺失尾事件仍按现有 revision 规则恢复。

每组修复均先观察到直接 RED，再完成最小实现、针对性验证和只读代码审核。本节最终全量验收结果以最新命令输出为准。

### 9.4 五次审核跨文件原子提交与并发修复

五次审核继续闭合状态、指针与事件日志之间的中断窗口：

- 更新事务先暂存目标 `pointer.tmp`，再提交状态、提升指针并写入 `committed`；临时指针只有在目标状态达到对应 revision 后才可恢复，尚未提交的临时指针不会遮蔽正式指针。
- 普通更新和跨 Story 初始化均覆盖“指针已暂存但状态未提交”与“状态已提交但指针未提升”故障窗口，状态已提交时默认入口可以恢复正确运行。
- 新 Story 初始化发现旧运行已完成时，会在全局初始化锁内获取旧 Story 锁、重新读取并对账事件，再替换活动指针，避免孤立 `complete intent` 被遗留。
- 仍在执行的 `complete` 持有 Story 锁时，并发 `init` 明确失败；待完成操作释放锁后可重试，旧事务只产生唯一一组 `intent/committed`。

新增回归均先观察到直接 RED，最小修复后的状态运行时、结构、状态模板和差异检查通过；独立只读总复审未发现 `BLOCKER/WARNING`。最终验收中，状态运行时、源指纹、Harness 状态、知识生成/查询/新鲜度测试，以及结构、两类状态模板、任务 DAG、完整冒烟和差异检查均退出 0；知识库 `backend/frontend/common` 均为 fresh，业务源码差异为空。
