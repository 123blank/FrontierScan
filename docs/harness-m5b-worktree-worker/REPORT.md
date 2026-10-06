# Harness M5-B1 Worktree 内 Worker 执行与结果回收报告

## 1. 结论

M5-B1 已实现内部 `runWorktreeWorker`，在 M3 `prepare`、M5-A 已创建 Worktree 和 M4-B `runWorkerTask` 之间建立单任务纵向闭环。实现不提供 CLI，不创建、合并或删除 Worktree，不调用 M3 `apply`，也不修改 backend/frontend 业务源码。

## 2. 需求覆盖

- M3 task 必须匹配 active state revision 和 `prepared` checkpoint。
- M5-A plan/status、DAG SHA、Worktree branch/HEAD/base 在执行前重新核验。
- DAG 必须恰好一个 pending task，且 DAG owner 与 M3 owner 一致。
- 当前 run Harness 输入完成全量预检后复制；其他上下文直接读取固定 base Worktree。
- 已声明且通过权限校验的 base 上下文可作为业务候选更新；`main-run` 和未声明候选的上下文继续保持不可变。
- Provider 输出经过 M4-B 契约校验和 M5-B1 Git 完整变更对账。
- 仅 phase output 返回 `ready-for-apply`，主工作树正式 result 最后写入。
- 存在业务写入返回 `ready-for-integration`，不复制业务代码，不写 M3 正式 result。
- receipt、result 和文件哈希支持幂等复用；Provider 失败后可复用已验证输入快照。
- phase-output Worker 完成后中断可恢复；无 durable candidate list 的业务写入恢复失败关闭。

## 3. TDD 与测试

按 RED -> GREEN 顺序覆盖了入口、身份、单任务、Worktree 状态、输入快照、已有源码编辑、Provider 边界、Git 对账、分级回收、幂等、恢复、锁、显式 apply、输入原子性、checkpoint 和 receipt 完整性。

当前新测试：

- `worktree-worker-runtime.test.mjs`：19/19 通过。
- `worktree-runtime.test.mjs`：11/11 通过。
- `worker-runtime.test.mjs`、`story-runtime.test.mjs`、`state-runtime.test.mjs`、`harness-status.test.mjs` 和 `task-dag.test.ps1`：全部通过。

最终结构校验通过（23 个目录、145 个必需文件、13 个 Skill），Smoke 完成；backend/frontend/common 知识均为 `fresh`；M5-B1 state 和 5 节点 DAG 校验通过。交付前继续执行 diff 与范围检查。

## 4. Review 结论

Review 发现并修复了以下稳定性问题：

1. Provider 失败后已有输入快照无法显式重试。
2. 后续输入校验失败会残留部分复制文件。
3. task 未绑定 M3 prepared checkpoint。
4. 无 receipt 恢复会推断未被 result 记录的业务文件。
5. receipt 复用未检查后来新增的 Worktree 变更。
6. 合法的已有源码编辑会被误判为输入篡改，无法进入 `ready-for-integration`。

每项均先增加失败测试再修复。当前未发现影响稳定性、基本可用性或近期扩展的 `BLOCKER/WARNING`。

## 5. 延期边界

- M5-B2 再处理业务代码集成、task-level dispatch、多任务聚合、多 Worktree 波次、merge/remove 和冲突解决。
- 同进程 mock Provider 不是操作系统沙箱；真实 Agent 需要结合 Codex sandbox/custom agent 复验。
- 断电级 fsync、多文件全局事务、进程崩溃发生在输入复制与 manifest 落盘之间、跨平台 Git 输出差异和自动清理属于低概率边界，本阶段不加固。
- 业务写入在 receipt 生成前中断时，因为 M3 result 不记录业务候选清单，本阶段选择失败关闭，不自动推断。

## 6. 交付状态

本 Story 完成后停留在 `git-delivery`。未经用户单独批准，不执行 `git add`、`git commit`、`git push`、PR、分支删除、合并、发布或部署。
