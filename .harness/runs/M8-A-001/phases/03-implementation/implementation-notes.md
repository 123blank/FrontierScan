# M8-A 实现记录

## 实现结论

M8-A 已完成真实只读 `code-reviewer` Provider 的配置、契约、冻结上下文、Codex CLI Adapter、Provider Runtime、CLI 与 E2E 状态映射实现。

本阶段只开放：

- `role=code-reviewer`
- `adapter=codex-cli`
- `codex exec --sandbox read-only`
- Runtime 生成 evidence、审核报告和阶段 result

未开放开发角色、`openai-compatible`、自动修复、自动 Git、发布、Worktree 或并行 Agent。

## 开发方法

采用 TDD：

1. Provider 配置、契约、上下文、Adapter、Runtime、CLI 和 E2E 映射均先编写失败测试。
2. 每个 RED 均确认由缺失行为或已复现缺陷触发。
3. 使用最小实现转为 GREEN。
4. 独立只读审核发现的问题均增加复现测试后修复。

独立审核期间关闭的主要问题包括：

- `failed` response 被错误物化为审核通过。
- Prepare 在 context manifest 写入后中断无法恢复。
- Adapter 异常缺少失败 receipt。
- WARNING-only 审核记录被错误标记为 BLOCKER。
- 子进程继承父进程敏感环境变量。
- 引号、JSON 和结构化事件中的秘密脱敏缺口。
- spawn error 在有效 PID 前污染锁。
- 脱敏后 diagnostics 和 finding 身份冲突。
- schema-invalid response 无法提交失败 receipt。
- E2E 将绝对 State 路径传入 Provider。

## DAG 状态语义

本结果将 12 个 DAG 节点标记为 `done`，表示对应实现、测试、审核脚手架和真实验收入口均已完成。

`T12-REAL-CLOSURE` 的 `done` 不表示真实外部调用已经成功。真实 `codex exec` 是否执行、是否通过以及最终 Story 是否闭环，仍必须由后续 code-review、interface-verification、delivery-preparation 的结构化 result 和 execution receipt 判定。

## 安全边界

- Provider CLI 不接受 Adapter、executable、argv、prompt、context path、timeout 或输出路径覆盖。
- Codex 子进程仅接收固定参数和环境变量白名单。
- `read-only` 是写入边界，不是严格文件读取 ACL。
- Agent 不直接写 State、正式报告或 result。
- request、context、response、receipt 和输出均绑定 SHA-256。
- `result.json` 是 Materialize 的最后提交点。
- Provider 失败、非法输出、完整性漂移和锁竞争均失败关闭。

## 实际修改范围

实际修改仅覆盖 M8-A Provider 配置、Schema、Runtime、测试、CLI、结构清单和实施计划，没有修改 FrontierScan 业务代码。
