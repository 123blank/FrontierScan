# FrontierScan Harness M4-B 受约束 Mock Worker 实施报告

> 日期：2026-07-17
> Story：`M4-B-001`
> 当前状态：实现、测试和审核完成；等待未批准的 Git 交付决策

## 1. 实现结论

M4-B 已在 M3 `prepare` 与 `apply` 之间增加内部 `runWorkerTask`。它读取 M3 task、校验 12 角色策略、构造显式有界 context、调用测试注入 provider，并在全量校验后采用阶段产物先写、`result.json` 最后写的顺序落盘。Worker 不调用 M2/M3，状态只由调用方显式 `apply` 推进。

## 2. 已实现能力

- M3 与 Worker 共用 Dispatch Schema `1.0` 结构和 record 状态校验。
- 12 个 Worker 策略与 Agent 注册表名称、类别一一对应。
- planning、test-case-designer、interface-verifier、code-reviewer、publisher 和 git-committer 只能生成当前 phase 必需产物。
- backend-developer、frontend-developer、code-fixer 和 unit-tester 按固定 capability 和路径前缀双重限制候选文件，其中 unit-tester 仅额外允许写入 `backend/src/test/`。
- context 和候选文件执行单文件 2 MiB、总量 8 MiB 限制；provider 最长 30 秒。
- provider 异常、超时、身份不符、非法 Schema、输出、record、capability、路径或大小均在落盘前失败。
- 产物写入后中断且 result 不存在时，同一 dispatch 重试可覆盖产物；result 已存在时在 provider 前拒绝重复执行，并转入显式 apply 或人工检查。

## 3. TDD 证据

按顺序观察到以下 RED：

1. 缺少 `dispatch-contract.mjs`，Worker 测试无法导入。
2. 缺少 `runWorkerTask` 导出，上下文与 provider 测试无法运行。
3. Worker 只返回 provider 原始值，合法候选未写入且无完成状态。
4. 非法 record status 和 phase 外 result path 被提前写出。
5. 写后中断钩子被忽略，`result.json` 已生成。
6. M2 PowerShell 入口 fixture 未复制共享 Dispatch 依赖，临时入口启动失败。
7. Harness 状态测试未发现 M4-B 结构和文档登记。
8. result 已存在时重复执行同一 task 仍会再次调用 provider，并在 apply 前后覆盖既有产物。

每个 RED 均通过最小实现转为 GREEN，并在进入下一任务前重跑 Worker/M3 或 M2 相关回归。

## 4. 安全和延期边界

- 同进程 mock provider 是测试依赖注入边界，不是针对恶意本地代码的 OS 沙箱。
- 不处理断电级 fsync、多文件全局事务、并发 Worker 和自动清理进程崩溃遗留临时文件。
- 不启动真实 Codex Agent，不提供 shell、网络、Git、发布、部署或状态命令。
- 不修改实际 backend/frontend 业务源码；权限写入只在临时 fixture 中验证。

以上边界不影响当前 mock Worker 主流程，真实 Agent 接入时必须重新评估。

## 5. Review 修复

审核循环发现并修复五项问题：

1. Windows 大小写等价候选或父子候选路径可能在全量预检后发生实际文件冲突，导致部分阶段文件先写。当前按目标文件系统生成路径键，并在写临时文件前拒绝等价和父子重叠路径。
2. Worker 曾允许缺少证据路径的 `test` record，生成的 result 会被 M3 apply 拒绝。当前该语义位于 M3/Worker 共用契约。
3. 策略曾可把合法枚举中的业务写 capability 配给 planning/review 角色。当前 12 个角色的 capability 集合是运行时固定不变量，策略不能扩大角色能力。
4. 设计和实施报告曾把全部 verification 角色描述为只能生成 phase 产物，与 unit-tester 的 `backend-test-write` 策略不一致。当前文档已改为列出只读角色，并明确 unit-tester 仅额外允许写入 `backend/src/test/`。
5. 同一 task 在 result 已存在或 M3 已 apply 后仍可重新调用 provider 并覆盖产物。当前 Worker 在 task/phase 身份校验后检查 `result.json`，存在时在 provider 前拒绝执行；result 缺失的中断恢复路径保持可用。

最终只读审核未发现影响稳定性、基本可用性或近期扩展的未解决 `BLOCKER/WARNING`。

## 6. 最终门禁

最后一轮在全部 Review 修复完成后重新执行：

- Worker、M3、M2、Harness status 和 UTF-8 DAG 测试全部通过。
- 结构校验通过：21 个目录、129 个必需文件、13 个 Skill。
- active pointer、M3、M4-A、M4-B 和两个状态模板全部通过校验。
- M4-B DAG 为 5 个任务、4 条边、5 个串行波次，通过校验。
- 完整 Smoke 跑通 M2 init、M3 prepare、M4-B Worker 和 M3 apply。
- backend/frontend/common 知识均 fresh，无刷新任务。
- backend/frontend 无差异，构建计划为 no-build-required。
- `git diff --check` 无空白错误，仅有 Windows LF/CRLF 转换提示。

未经用户单独批准，不执行 Git 暂存、提交、推送或 PR；Harness 最终停留在 `git-delivery`。
