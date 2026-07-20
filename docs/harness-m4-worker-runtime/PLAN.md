# FrontierScan Harness M4-B 实施计划

> 执行约束：T1-T5 串行执行；每个运行时行为先 RED、再最小 GREEN 和范围审核。禁止真实模型、Worker CLI、Worktree、业务源码修改、发布、部署和 Git 写入。

## T1：Dispatch 契约与策略加载

- [x] 新增共享 task/result 结构校验，保持 M3 Schema `1.0`。
- [x] 新增 Worker 策略 Schema 和 12 角色策略。
- [x] 缺失、重复、未知角色、类别漂移、非法能力和非法路径必须在 provider 调用前失败。

## T2：上下文与 Provider 边界

- [x] 显式加载 `contextFiles`，拒绝越权路径、符号链接、非 UTF-8 和大小超限。
- [x] provider 仅接收 task、当前角色策略、上下文和 AbortSignal。
- [x] provider 异常或最多 30 秒超时不产生候选文件或结果。

## T3：候选结果、权限与原子写入

- [x] 在落盘前校验身份、结构、输出集合、record、capability、路径和大小。
- [x] 所有候选先写同目录临时文件并 rename，`result.json` 最后写入。
- [x] 无效结果不得修改阶段产物或 Harness 状态。

## T4：恢复和纵向闭环

- [x] 模拟产物写入后中断，同一 dispatch 重试成功。
- [x] `result.json` 已存在时拒绝重复执行 provider，apply 前后均不得覆盖既有产物。
- [x] 临时 Story 完成 `prepare -> mock Worker -> apply`，Worker 后 revision 不变，apply 后只推进一次。
- [x] M3 Adapter 保持独立，Worker 不替代 Adapter 或 M2/M3 门禁。

## T5：集成、文档与审核

- [x] 登记 runtime、测试、Schema、策略和文档并更新 Harness 说明。
- [x] 运行 Worker、M3、M2、状态、结构、Smoke、知识和 diff 门禁。
- [x] 循环审核直至没有影响稳定性、基本可用性或近期扩展的 `BLOCKER/WARNING`。
- [x] 未经批准不执行 Git 写入，最终停留在 `git-delivery`。
