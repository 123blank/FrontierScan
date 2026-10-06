# M5-B1-001 接口验证报告

## 环境

- 类型：本地临时 Git 仓库 fixture。
- 外部 API/UI：不适用；本 Story 没有 HTTP、页面、数据库或部署接口。
- 真实 FrontierScan Worktree：未创建。

## 用例

| Case | Action | Expected | Actual | Result | Evidence |
| --- | --- | --- | --- | --- | --- |
| T1-C1/T1-C2 | 调用 `runWorktreeWorker`，传入 owner 不一致、多任务、absent Worktree 和旧 revision | Provider 前失败且 state 不变 | 全部按预期拒绝，Provider 0 次 | pass | `worktree-worker-runtime.test.mjs` |
| T2-C1/T2-C2 | 提供当前 run 与 base context，并注入缺失的后续输入 | 混合快照正确；非法输入不留部分文件 | Provider 收到正确内容；非法输入后 Worktree 干净 | pass | 同上 |
| T3-C1/T3-C2 | Provider 更新已读取的现有源码，并模拟响应外额外写入 | 已声明且授权的 base 候选通过并可幂等复用；额外 Git 变更失败 | 与预期一致 | pass | 同上 |
| T4-C1 | 分别返回 phase-only 和 backend 写入 | 返回 `ready-for-apply` / `ready-for-integration` | 两条路径均通过；业务写入未进入主工作树或正式 result | pass | 同上 |
| T4-C2 | 模拟 Provider 首次失败、Worker 后中断、receipt 重复调用和 receipt 后新增文件 | 显式重试/幂等安全，未知文件失败关闭 | 与预期一致；Provider 未被重复调用 | pass | 同上 |
| T5-C1 | `ready-for-apply` 后显式调用 M3 `apply` | apply 前 revision 4，apply 后只推进到 revision 5 | 与预期一致 | pass | 同上 |
| T5-C2 | 执行回归、结构、Smoke、知识与 Review | 门禁通过且无 BLOCKER/WARNING | 全部通过 | pass | `test-report.md`、`code-review-report.md` |

## 结论

M5-B1 内部接口验收通过。外部 API/UI 环境不适用，没有伪造接口请求或页面验证结果。
