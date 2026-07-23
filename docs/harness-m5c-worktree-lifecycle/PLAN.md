# Harness M5-C 单 Worktree 生命周期收尾实施计划

## 1. Story 与成功标准

Story 固定为 `M5-C-001`。实现完成后，完成的 M5-B2 单任务 Worktree 仅在用户批准和 `-ConfirmRetire` 后可被安全回收；所有未提交内容必须由 M5-B1/M5-B2 凭据解释，分支保留，目标 Harness 状态不变。

## 2. 串行任务

- [x] 初始化 `M5-C-001`，读取 M5-A/B1/B2 Runtime、测试、报告和知识新鲜度。
- [x] 创建 requirement、technical-design 和 task DAG 产物，登记结构资产及 M5-C 设计文档。
- [x] **T1 - Retire 契约 RED/GREEN**：先为 `retire` 命令、`ConfirmRetire`、终态检查、receipt Schema 和 PowerShell 参数写失败测试；再扩展 M5-A Runtime 与薄入口。
- [x] **T2 - 凭据与变更集合 RED/GREEN**：先验证 execution/integration receipt、主树候选、Worktree 已知输入/输出、锁和漂移均失败关闭；再实现全量预检。
- [x] **T3 - Git 移除与恢复 RED/GREEN**：在临时 Git fixture 中验证强制移除、分支保留、receipt 原子写入、重复调用和 Git 成功后中断恢复。
- [x] **T4 - 纵向验收与文档**：跑完整 M5 链路，更新 README、结构清单、架构适配、AI 交接、知识概览和 `REPORT.md`。

每个任务都按 RED、GREEN、重构、针对性测试和 task-owned diff 审核完成后，再进入下一项。

## 3. 预计资产

- 修改 `.harness/scripts/lib/worktree-runtime.mjs` 与 `.harness/scripts/run-worktree.ps1`。
- 新增 `.harness/schemas/worktree-retirement-receipt.schema.json` 与 `.harness/scripts/tests/worktree-lifecycle-runtime.test.mjs`。
- 更新 Harness 结构清单、脚本说明和 M5-C 相关文档；不修改 backend、frontend、数据库或部署资产。

## 4. 最终门禁

```powershell
node .\.harness\scripts\tests\worktree-lifecycle-runtime.test.mjs
node .\.harness\scripts\tests\worktree-runtime.test.mjs
node .\.harness\scripts\tests\worktree-worker-runtime.test.mjs
node .\.harness\scripts\tests\worktree-integration-runtime.test.mjs
node .\.harness\scripts\tests\worker-runtime.test.mjs
node .\.harness\scripts\tests\story-runtime.test.mjs
node .\.harness\scripts\tests\state-runtime.test.mjs
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.harness\scripts\tests\task-dag.test.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.harness\scripts\validate-structure.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.harness\scripts\smoke-harness-flow.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.harness\scripts\check-kb-freshness.ps1
git diff --check
```

完成后仅审核 M5-C owned diff。除测试 fixture 外，不创建、回收或删除正式 FrontierScan Worktree；未经单独批准不执行 Git 交付、PR、发布或部署。
