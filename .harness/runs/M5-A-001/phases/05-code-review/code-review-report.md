# M5-A-001 代码审核报告

> 日期：2026-07-20
> 范围：M5-A owned diff
> 轮次：最终
> 状态：通过，无未解决 BLOCKER/WARNING

## WARNING-1：baseRef 缺少 Git 选项终止符

- 文件：`.harness/scripts/lib/worktree-runtime.mjs`
- 证据：`rev-parse --verify <baseRef>^{commit}` 直接接受可配置 `baseRef`，没有 `--end-of-options`。
- 影响：以 `--` 开头的输入可能被 Git 当作选项，违反固定 argv 的失败关闭边界。
- 动作：加入 `--end-of-options`，增加 argv 边界测试。

## WARNING-2：DAG Schema 与运行时校验口径漂移

- 文件：`.harness/scripts/lib/task-dag-contract.mjs`
- 证据：Schema 要求 nodes/waves 至少一项且 globalChanges/risks 为字符串，但共享运行时仍可接受空 DAG 或非字符串内容。
- 影响：`validate-task-dag.ps1` 可能认可不符合登记 Schema 的 DAG，影响后续计划器判断。
- 动作：在共享契约同步约束并增加失败用例。

## 补充收紧

`worktree-plan.schema.json` 禁止额外字段，运行时应同步拒绝额外属性，避免结构契约继续漂移。

## WARNING-3：当前 Story 的未提交 Harness 产物会永久阻塞创建

- 文件：`.harness/scripts/lib/worktree-runtime.mjs`
- 证据：主仓库清洁检查只排除 plan/status/lock 目录；正常流程在 Git 交付前产生的 state、Task DAG 和当前 run phase 文件仍会出现在 Git status。
- 影响：即使业务代码完全干净，正式 Story 也无法执行 `Create`，主流程不可用。
- 动作：只排除已验证的 state、绑定 DAG 和当前 run 目录；其他 Harness 或业务修改继续阻塞，并增加未提交 Harness fixture 回归。

## BLOCKER-4：嵌套 Worktree 未从主仓库状态排除

- 文件：`.gitignore`、`.harness/scripts/tests/worktree-runtime.test.mjs`
- 证据：临时仓库成功创建后，主仓库 `git status --porcelain=v1 --untracked-files=all` 报告 `?? .harness/worktrees/M5-A-FIXTURE/T1/`。
- 影响：正式创建会立即污染主仓库状态，并使后续清洁检查和交付摘要包含整个嵌套 Worktree。
- 动作：仅忽略 `.harness/worktrees/`，保留 `.harness/runs/` 证据可见性，并增加真实 Git 回归断言。

## WARNING-5：非法 ownerAgent 会生成不可继续使用的计划

- 文件：`.harness/scripts/lib/task-dag-contract.mjs`、`.harness/schemas/task-dag.schema.json`
- 证据：共享契约原先接受 `ownerAgent: 42`，`plan` 会写出违反 Worktree Plan Schema 的产物，后续 `status/create` 才拒绝。
- 动作：在共享 DAG 入口和 Schema 将存在的 `ownerAgent` 限制为非空字符串，并增加 RED-GREEN 回归。

## WARNING-6：Windows 驱动器相对路径被当作仓库相对路径

- 文件：`.harness/scripts/lib/task-dag-contract.mjs`
- 证据：`path.win32.isAbsolute("C:outside.md")` 为 false，旧校验会放行带驱动器 root 的路径。
- 动作：使用 `path.win32.parse(value).root` 失败关闭，并增加 `C:outside.md` 回归。

## WARNING-7：Worktree 忽略规则测试缺少 runs 正向断言

- 文件：`.harness/scripts/tests/worktree-runtime.test.mjs`
- 证据：旧断言只检查 `.harness/worktrees/` 不出现，无法阻止未来误把整个 `.harness/` 忽略。
- 动作：同时断言 plan/status 两个 `.harness/runs/` 证据文件出现在主仓库状态。

## WARNING-8：实施报告 revision 表述已过期

- 文件：`docs/harness-m5-worktree-orchestration/REPORT.md`
- 证据：状态在 revision 12 进入 `git-delivery`，之后追加测试和审核证据；报告仍把 12 表述为当前 revision。
- 动作：改为记录阶段进入点，并声明当前 revision 以状态运行时为准，避免追加证据后再次漂移。

## 修复验证

- `baseRef` 的两处 `rev-parse` 均加入 `--end-of-options`，argv 回归通过。
- 空 DAG、非字符串 globalChanges/risks 和额外 plan 字段均在共享契约入口拒绝。
- 未提交当前 Story state、DAG 和 run 产物的临时仓库可以创建；额外业务脏文件仍被拒绝。
- Worktree 目录不再出现在主仓库状态中，`.harness/runs/` 仍作为可交付证据保留。
- 非字符串 `ownerAgent` 与 `C:outside.md` 均在共享 DAG 入口拒绝，Schema 与运行时保持一致。
- 真实 Git 测试正向确认 plan/status 运行证据可见，实施报告不再硬编码易漂移的当前 revision。
- M5-A 11 个 Worktree 用例、DAG、M4-B、M3、M2、结构、Smoke、知识与 no-build 门禁重新通过。

## 最终结论

最终复审未发现影响稳定性、基本可用性或近期扩展的未解决 `BLOCKER/WARNING`。剩余断电级持久化、遗留锁自动回收、非 Windows 差异和多 Worktree 生命周期按批准范围延期，不阻塞 M5-A。
