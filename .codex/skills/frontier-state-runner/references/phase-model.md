# Frontier Harness 阶段模型

用于判断当前工作流位置和进入下一阶段前必须存在的证据。

## 产品级阶段

| 阶段 | Owner | 目的 | 推进前证据 |
| --- | --- | --- | --- |
| `breakdown` | `product-analyst` | 将产品请求拆分为 Story。 | Story ID、标题、影响模块和验收标准。 |
| `forking` | `task-planner` | 独立运行各 Story。 | 每个 Story 的状态和进度证据。 |
| `joining` | `backend-developer` | 集成已审核结果。 | 集成、构建、验证证据或阻塞报告。 |
| `done` | `git-committer` | 产品级交付准备完成。 | 交付报告；实际 Git 操作如有发生则另行记录。 |
| `blocked` | 任意角色 | 无法继续。 | 阻塞理由、Owner 和下一决策。 |

## E2E State v2 阶段

| 阶段 | Owner | 目的 | 推进前证据 |
| --- | --- | --- | --- |
| `requirement` | `requirement-analyst` | 澄清需求和验收标准。 | 需求拆解报告。 |
| `technical-design` | `requirement-analyst` | 形成技术方案。 | 技术设计报告。 |
| `task-dag` | `task-planner` | 形成任务图。 | 有效 Task DAG。 |
| `implementation` | `backend-developer` | 实现任务范围内修改。 | 实施记录。 |
| `unit-test` | `unit-tester` | 执行测试。 | 测试报告和通过记录。 |
| `code-review` | `code-reviewer` | 只读审核修改。 | 审核报告且无未解决 BLOCKER。 |
| `build-publish` | `publisher` | 构建并按批准决定是否发布。 | 构建报告；真实发布需独立批准。 |
| `interface-verification` | `interface-verifier` | 按验收标准验证行为。 | 验证报告或环境不可用说明。 |
| `delivery-preparation` | `git-committer` | 汇总交付准备状态，不执行 Git。 | 交付报告。 |
| `done` | 任意角色 | 业务开发和交付准备闭环完成。 | 所有必需门禁具备证据；不表示 Git 已执行。 |
| `blocked` | 任意角色 | 等待外部决策或依赖。 | `runtime.activeBlock`、日志和事件证据。 |

State v1 保留历史 `git-delivery` 阶段语义，但仅允许 `status` 和 `validate`，不得再推进或完成。

## 质量门禁

- `task-dag` 校验失败时不得推进。
- `unit-test` 存在失败的必需测试时不得推进。
- `code-review` 存在未解决 BLOCKER 时不得推进。
- `build-publish` 中的真实发布必须获得用户明确批准。
- `delivery-preparation -> done` 不执行 Git；Git 暂存、提交、推送和 PR 仍需独立批准。
