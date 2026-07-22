# M5-B2-001 接口验证报告

## 环境

临时 Windows Git 仓库 + 真实 `git worktree` + Node Runtime + PowerShell CLI。M5-B2 是 Harness 内部接口，不依赖 backend/frontend 服务、认证、数据库或外部网络。

## 用例

| Case | Action | Expected | Actual | Result | Evidence |
| --- | --- | --- | --- | --- | --- |
| T1-C1 | 临时仓库执行 M3 prepare -> M5-A plan/create -> M5-B1 mock Worker -> M5-B2 Plan/Status/Apply -> M3 apply；另通过 PowerShell 入口验证无确认拒绝和确认 Apply | 业务候选在确认后写入，正式 result 最后生成；M5-B2 不推进 revision，M3 只推进一次 | PowerShell 与纵向两个用例通过；无确认 Apply 被拒绝，确认后 status 为 `ready-for-apply`，M3 进入 `unit-test` | pass | `worktree-integration-runtime.test.mjs` 的 `PowerShell entry...`、`vertical flow...` |
| T1-C2 | 注入 artifact rename 后中断、result 后中断、写入间人工修改和 receipt 前人工修改 | 已完成 candidate 可恢复；未知内容不覆盖；漂移后不写成功 receipt；M2/M3 状态不变 | 4 个恢复/竞态用例通过，锁释放、重复 Apply 可恢复，人工内容保留且 receipt 不生成 | pass | `apply resumes...`、`apply rechecks...` |

执行命令：

```powershell
node --test --test-name-pattern "PowerShell entry|vertical flow|apply resumes|rechecks each pending|rechecks every artifact" .\.harness\scripts\tests\worktree-integration-runtime.test.mjs
```

结果：6/6 PASS，exit code 0。

## 结论

验收标准均通过。验证未修改正式 FrontierScan 业务源码，临时 Worktree 随 fixture 清理；未执行发布、部署、Git 提交或正式仓库 Apply。
