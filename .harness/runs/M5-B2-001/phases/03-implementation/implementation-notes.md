# M5-B2-001 实现记录

## 已实现

- 新增 `worktree-integration-runtime.mjs`，提供内部 `plan/status/apply` 接口。
- Plan 绑定 active state、M3 prepared task/checkpoint、单 pending DAG task、M5-A plan/status 和 M5-B1 receipt/manifest/result。
- 业务候选、phase output 和正式 result 固化为 SHA-256 内容寻址 bundle，限制单文件 2 MiB、总量 8 MiB。
- Status 从主工作树 HEAD、Git 业务差异、Git 逻辑 base 和 candidate 哈希重建 `planned/applying/ready-for-apply/inconsistent`。
- Apply 要求 `confirmApply`，使用任务级独占锁、稳定写入顺序、同目录临时文件加 rename、逐文件状态和最终 integration receipt。
- 新增 PowerShell `Plan/Status/Apply` 薄入口，未暴露任意 Worktree、receipt、bundle、目标路径或 test hook 参数。
- 新增 plan、status、receipt 三个 JSON Schema 和临时 Git fixture 测试。

## TDD 与修复

- Plan RED 首先因 Runtime 缺失失败；GREEN 后覆盖 outcome、result 身份、候选/证据漂移、已有正式 result、bundle 和重复 Plan。
- Status RED 首先因命令不支持失败；GREEN 后覆盖确认门禁、HEAD 漂移、未解释业务修改、目标冲突、符号链接、bundle 篡改和遗留锁。
- Apply RED 首先因写入未实现失败；GREEN 后覆盖已有/新增业务文件、result-last、逐文件中断恢复、result 后中断和重复 Apply。
- 审核补充 RED/GREEN：首次 Plan 拒绝无关业务脏文件；已存 plan 的 artifact 和正式 result 路径必须从 M5-B1 receipt 与 M3 task 重新推导。
- 纵向测试确认 M5-B2 前后 revision 不变，调用方显式 M3 apply 后推进一次。当前 M3 的 `already-applied` 仅覆盖状态已推进但 checkpoint 未完成的中断窗口，不把正常完成后的第二次 apply 误列为契约。

## 当前验证

- `worktree-integration-runtime.test.mjs`：最终 24/24 通过，包含 Windows checkout filter 回归。
- `worktree-worker-runtime.test.mjs`：19/19 通过。
- `worktree-runtime.test.mjs`：11/11 通过。
- `worker-runtime.test.mjs`：通过。
- `story-runtime.test.mjs`：通过。

## Owned Files

- `.harness/scripts/lib/worktree-integration-runtime.mjs`
- `.harness/scripts/run-worktree-integration.ps1`
- `.harness/scripts/tests/worktree-integration-runtime.test.mjs`
- `.harness/schemas/worktree-integration-*.schema.json`
- `.harness/runs/M5-B2-001/**`
- `docs/harness-m5b2-worktree-integration/**`

文档登记与项目级交接更新在后续文档任务完成。未修改 M3/M4-B/M5-A/M5-B1 核心实现，也未修改正式业务源码。
