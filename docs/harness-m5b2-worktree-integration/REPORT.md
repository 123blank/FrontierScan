# Harness M5-B2 单 Worktree 业务变更受控集成报告

## 1. 交付摘要

M5-B2 新增单 Worktree、单任务、单 dispatch 的 `Plan/Status/Apply` 闭环。它消费 M5-B1 `ready-for-integration` 凭据，以 SHA-256 bundle 固化业务候选、phase output 和 Worker result；在用户批准与 `ConfirmApply` 双重门禁后，将业务文件与 phase output 写入主工作树，最后生成正式 `result.json` 和 integration receipt。M5-B2 不调用 M3 apply，Harness revision 只由调用方显式执行一次 M3 apply 后推进。

## 2. 需求覆盖

| 需求 | 实现证据 |
| --- | --- |
| M5-B1 证据绑定 | state、task、checkpoint、DAG、M5-A plan/status、receipt、manifest、result 均校验身份和 SHA-256 |
| 内容寻址计划 | `bundle/sha256-<hex>.blob`，单文件 2 MiB、总量 8 MiB |
| 主工作树门禁 | HEAD 固定、Git 业务差异白名单、Git 逻辑 base/candidate 哈希、符号链接拒绝 |
| 批准控制 | 外部用户批准边界 + `confirmApply`/`-ConfirmApply` |
| 原子写入 | 同目录临时文件加 rename，业务文件 -> phase output -> result -> receipt |
| 中断恢复 | 每次从目标哈希重建状态，candidate 跳过、base 继续、未知内容失败 |
| M2/M3 边界 | M5-B2 不修改 state/checkpoint；纵向 fixture 由调用方显式 M3 apply 推进一次 |

## 3. TDD 证据

- Plan RED 因 Runtime 缺失失败；GREEN 覆盖 outcome、result 状态/身份、候选/证据漂移、已有正式 result、bundle 和重复 Plan。
- Status RED 因命令未实现失败；GREEN 覆盖确认、HEAD、未解释业务修改、目标冲突、符号链接、bundle 篡改和遗留锁。
- Apply RED 因写入未实现失败；GREEN 覆盖已有文件更新、新文件创建、result-last、逐文件中断、result 后中断和 receipt 幂等。
- 阶段审核补充两个 RED/GREEN：首次 Plan 拒绝无关业务脏文件；重复 Plan/Status 从 M5-B1 receipt 重新推导 artifact 和固定 M3 result 路径。
- 交付前审核补充 Windows checkout filter RED/GREEN：`core.autocrlf=true` 重新检出的干净 CRLF 文件可完成 `Plan/Status/Apply`，未知业务修改仍失败关闭。
- PowerShell 与纵向 RED/GREEN 覆盖参数转发、无确认拒绝、确认 Apply、M5-B2 revision 不变和显式 M3 单次推进。

最终已执行并通过：

- `worktree-integration-runtime.test.mjs`：24/24。
- `worktree-worker-runtime.test.mjs`：19/19。
- `worktree-runtime.test.mjs`：11/11。
- `worker-runtime.test.mjs`、`story-runtime.test.mjs`：通过。

最终新鲜验证结果：M5-B2 24/24、M5-B1 19/19、M5-A 11/11；M4-B、M3、M2、Harness status、Task DAG、结构、Smoke、知识新鲜度和差异门禁全部通过。M3 固定 `harness-state-tests`、`harness-m3-tests`、`harness-structure` Adapter 均通过。

## 4. 设计校正

实现验证确认 M3 `already-applied` 只覆盖“状态已推进但 checkpoint 尚未完成”的中断窗口。正常完成后的第二次 M3 apply 会进入新 phase，因此 M5-B2 纵向闭环只调用一次 M3 apply；重复幂等由 M5-B2 integration receipt 保证。该结论已同步 DESIGN、PLAN 和交接文档，未扩大 M3 范围。

Task DAG 最初预计文件未列出 `.harness/structure-manifest.yaml`，文档收尾确认结构登记必须修改该文件。实际修改已严格限制为登记 M5-B2 资产，本偏差记录于此，不修改已绑定的历史 DAG 证据。

交付前 Review 发现原实现直接比较 Git blob 与工作树原始字节，在 Windows `core.autocrlf=true` 时会把 Git 状态干净的 CRLF 文件误判为 base 漂移。修复保留 Git blob SHA-256 的证据绑定，改由 `git diff --quiet` 判断工作树逻辑 base，并在每次写入前复核；未扩展 Schema 或公开接口。

## 5. 安全与延期边界

- 正式 FrontierScan `backend/src/**`、`frontend/src/**` 未执行真实 Apply；所有真实写入仅在临时 Git fixture。
- 不实现删除/重命名、自动回滚、多文件全局事务、merge/remove、Worktree 清理、多任务、多 Worktree、真实 Agent、Git 自动交付、发布或部署。
- 断电级 fsync、恶意同进程调用方、跨平台 Git 差异和未知临时文件自动清扫作为低概率边界延期，不阻塞当前单机 Windows Harness 主流程。

## 6. 最终门禁与 Review

完整回归已通过，详细命令位于 `.harness/runs/M5-B2-001/phases/04-unit-test/test-report.md`。最终 owned diff Review 已修复逐文件竞态、固定 result 映射、receipt 严格字段、identifier 校验和 Windows checkout filter 误判问题，当前无未解决 `BLOCKER/WARNING`；证据位于 `.harness/runs/M5-B2-001/phases/05-code-review/code-review-report.md`。

## 7. Harness 最终状态

Story 已完成 requirement、technical-design、task-dag、implementation、unit-test、code-review、build-publish、interface-verification 和 git-delivery，并在 `.harness/states/e2e-M5-B2-001.json` 中进入 `done/completed`、revision 29。用户批准后，业务 Runtime 以 `d557e540d78033a317601de8edc516f859fdcd83` 提交，运行资产忽略规则以 `9e380e9eb2a6bbb7124258c426ea2678c28d68e6` 提交，均已推送至 `origin/dev`。未创建 PR，未执行 Worktree 或分支删除、发布和部署。
