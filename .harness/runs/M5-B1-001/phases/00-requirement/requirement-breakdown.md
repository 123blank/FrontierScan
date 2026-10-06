# M5-B1-001 需求拆解

## 目标

在 M3 phase dispatch、M4-B 受约束 Worker 与 M5-A 单 Worktree 之间增加最小编排层，使已有 Worktree 能获得当前 Story 输入、执行 mock Worker，并按是否包含业务源码变更安全回收结果。

## 已确认业务规则

- 采用分级回收：仅 phase output 可进入 `ready-for-apply`；存在 backend/frontend 写入时进入 `ready-for-integration`。
- `ready-for-integration` 不写 M3 正式 `result.json`，不复制业务代码，不推进 phase/revision。
- 只提供内部 Node 接口；Provider 仅由测试注入，不提供 Mock CLI 或任意模块动态加载。
- 已提交源码和文档直接使用 Worktree `baseCommit` 版本；只复制当前 run 下的未提交 Harness 输入。
- Worktree 创建继续由 M5-A 独占；M5-B1 只消费并重新核验已有 plan/status。
- M5-B1 只支持 DAG 单任务 Story，且 DAG owner 必须与 M3 phase owner 一致；其他情况失败关闭。
- M5-B1 不调用 M3 `apply`；调用方在 `ready-for-apply` 后显式推进。

## 验收标准

- 已创建的单 Worktree 能消费当前 M3 task 和显式上下文并运行 mock Worker。
- 状态、DAG、owner、base、Worktree 或输入漂移在 Provider 调用前被拒绝。
- phase-output-only 回收到主工作树并返回 `ready-for-apply`，但 state revision 不变。
- 存在业务写入时只生成独立结果和哈希凭据，主工作树业务代码和 M3 正式 result 不变。
- Worker 完成后中断可按相同 dispatch 恢复，不重复调用 Provider。
- M2/M3/M4-B/M5-A 和 Harness 门禁继续通过。

## 影响范围

仅新增 Harness Node runtime、测试、Schema、运行证据和中文文档；按需最小更新 Harness README、结构清单、架构说明、交接文档和知识概览。

## 排除范围

不实现 Worktree 创建/合并/删除、多任务聚合、多 Worktree 波次、真实 Agent、shell、网络、Git 自动交付、发布、部署或 M2/M3 Schema 扩展；不修改 `backend/src/**` 和 `frontend/src/**`。

## 待确认事项

无。用户已授权后续不确定项统一采用本设计中的推荐失败关闭方案。
