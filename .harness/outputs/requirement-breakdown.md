# Harness M3 需求拆解

## 来源需求

在 M2 确定性状态运行时之上完成 Harness M3，使单个 Story 可以通过结构化任务输入、结构化结果、确定性命令适配器和 M2 门禁，从需求阶段推进到交付摘要。实现需保证基本可用和合理扩展，不处理低概率极端边界。

## 假设

- M3 以 `docs/harness-m0-m1/PLAN.md` 中的“Single-Story Vertical Slice”为权威范围。
- “Agent Dispatcher”在 M3 中表示文件式派发协议，不表示真实模型进程、多 Agent 并发或 Codex Plugin Runtime；后者属于 M4。
- 当前 Codex 会话或人工执行者负责认知工作，并按协议写入结果文件。
- M2 继续拥有阶段推进权，M3 不直接编辑活动状态 JSON。
- 当前实现只修改 Harness、测试和文档，不修改 `backend/src/**`、`frontend/src/**`。

## 阻塞问题

无。发布、提交、推送、PR、Worktree 和真实 Agent Runtime 均明确不在本阶段范围内。

## 使用的项目知识

| 范围 | 已读取内容 | 新鲜度或缺口 |
| --- | --- | --- |
| Harness 路线 | `docs/harness-m0-m1/PLAN.md`、`docs/AI-handover.md` | 路线内容可用；部分历史段落仍描述 M2 未完成，不作为当前状态证据 |
| M2 状态运行时 | `docs/harness-m2-state-runtime/DESIGN.md`、`REPORT.md`、`state-runtime.mjs` | 当前源码与报告一致 |
| 工作流与角色 | `.harness/workflows/e2e-development.yaml`、`.codex/agents/agents.yaml` | 角色仍是注册表，不是运行中 Agent |
| 结构化知识 | `llm-knowledge/overview.md` 与技术设计查询结果 | backend、frontend、common freshness 均为 `fresh`；overview 中“M2 未实现”叙述过期，已以源码核验替代 |

## Story

### M3-001 - 打通单 Story 文件式派发闭环

- 用户价值：让一个 Harness Story 能按当前阶段获得明确任务、提交可校验结果、执行受控本地命令并由 M2 门禁推进，跨进程恢复时不重复已完成阶段。
- 影响模块：`.harness/scripts/`、`.harness/schemas/`、`.harness/workflows/`、`.harness/runs/`、Harness 测试与 M3 文档。
- 新增或变更行为：增加单 Story Dispatcher CLI、结构化任务/结果契约、固定命令适配器、run 专属产物目录和可恢复阶段检查点。
- 验收标准：
  - [ ] `prepare` 根据 M2 当前状态和工作流阶段生成包含 `storyId`、`phase`、`ownerAgent`、state revision、允许操作及预期输出的结构化任务。
  - [ ] 所有阶段任务、结果、命令日志和必需产物位于 `.harness/runs/<storyId>/` 内，M2 能对这些必需产物记录 SHA-256 并推进。
  - [ ] `apply` 拒绝 Story、阶段、派发标识或输出路径不匹配的结果；缺失必需产物时状态 phase 和 revision 不变。
  - [ ] `completed` 结果只通过 M2 的 `record/next/complete` 推进；`failed` 保留当前阶段，`blocked` 通过 M2 记录阻塞原因。
  - [ ] unit-test 的失败命令证据和 code-review 的未解决 `BLOCKER` 均阻止后续推进。
  - [ ] 固定命令适配器使用参数数组执行，不接受任意 shell 命令；至少覆盖 Harness 测试/结构校验，并为 backend test、frontend build 保留明确适配入口。
  - [ ] 重启后能够读取既有任务、结果和检查点；已完成阶段不会重新派发，记录后中断的结果可以继续应用。
  - [ ] 代表性临时仓库测试可从 requirement 推进到 delivery summary，并覆盖缺失产物、失败命令、`BLOCKER` 和中途恢复。
  - [ ] publish、deploy、`git add/commit/push`、PR 和 Worktree 操作没有执行入口。
- 风险：M2 当前必需产物使用全局固定路径，需要以向后兼容的 `{runId}` 占位符扩展为 run 专属路径；不得破坏 M2 既有测试。
- 测试提示：使用 Node.js 临时仓库 fixture 观察 RED/GREEN；每个业务完成后运行对应测试、结构校验和只读差异审核。

## 非目标

- 真实模型调用、Codex Skill/Plugin 自动发现和 Agent 子进程权限沙箱。
- 多 Story、Fork-Join、DAG 波次并行和 Worktree 生命周期。
- 自动修复循环、真实部署、API/UI 环境验收和任何 Git 写操作。
