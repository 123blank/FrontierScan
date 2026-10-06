# M5-B2-001 需求拆解

## 目标

在 M5-B1 已生成 `ready-for-integration` 执行凭据后，将单 Worktree、单任务、单 dispatch 的业务候选以内容寻址 bundle 固化，并在用户批准和 `ConfirmApply` 双重门禁后安全写入主工作树。业务文件与阶段产物全部完成后最后生成 M3 正式 `result.json`，由调用方显式执行 M3 `apply` 推进状态。

## 影响范围

- 新增 M5-B2 Node Runtime、PowerShell 薄入口、三个 JSON Schema 和临时 Git fixture 测试。
- 更新 Harness 结构登记、脚本说明、架构适配、交接和知识概览。
- 不修改 FrontierScan 正式 `backend/src/**`、`frontend/src/**`、数据库、部署或外部服务。
- 不修改 M2 state、M3 dispatch/result Schema `1.0`、M4-B Worker 或 M5-A/M5-B1 的公开职责。

## 验收标准

1. 仅接受身份、哈希和 Git 事实一致的 M5-B1 `ready-for-integration` 凭据，且至少包含一个业务候选。
2. 相同证据重复 Plan 可复用；证据漂移时失败关闭且不覆盖旧计划。
3. 未批准 Apply、HEAD 漂移、未解释业务修改、目标冲突、符号链接或 bundle 篡改均在目标写入前拒绝。
4. 业务文件、phase output、正式 result 和 integration receipt 按固定顺序写入，正式 result 最后于所有候选出现。
5. 中断后可依据 base/candidate 哈希逐文件恢复；未知内容不覆盖、不 reset、不自动回滚。
6. M5-B2 不改变 Harness phase/revision；调用方显式 M3 apply 后只推进一次。
7. M2-M5 回归、结构、Smoke、知识和差异门禁通过，最终 Review 无未解决 `BLOCKER/WARNING`。

## 批准与安全边界

- Runtime 的 `confirmApply` 不能代替外部流程中的真实用户批准。
- 正式 FrontierScan 仓库不执行真实 Worktree Apply；真实写入测试只在临时 Git 仓库运行。
- 未经单独批准不执行 `git add`、`git commit`、`git push`、PR、分支合并/删除、Worktree 删除、发布或部署。

## 延期范围

多 Worktree、多任务聚合、删除/重命名、全局事务、自动回滚、merge/remove、真实 Agent、Git 自动交付和断电级持久化继续延期。跨平台 Git 行为、恶意同进程调用方和未知临时文件自动清扫作为低概率边界写入最终报告。

## 未决问题

无。`DESIGN.md` 与 `PLAN.md` 已经用户确认，可作为实施依据。
