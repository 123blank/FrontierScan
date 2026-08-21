# FrontierScan Harness Engineering 目标与差距基线

> 文档状态：目标基线
> 基线版本：1.3
> 建立日期：2026-08-11
> 最近更新：2026-08-21
> 当前实施基线：`b98a55a chore(harness): ignore local provider runtime artifacts`；M8-A 已完成并提交，尚未推送
> 参考文章：[从 AI Coding 到 Harness Engineering 的端到端工程开发实践](https://mp.weixin.qq.com/s/UE-RZH9hnbBd06CVapFGrA)
> 文章发布：腾讯技术工程，2026-07-03
> 原文核验方式：2026-08-11 在 Chrome 浏览器中直接阅读微信原文

## 1. 文档目的

本文档是 FrontierScan Harness 项目的长期目标基线，用于：

1. 准确总结参考文章提出和实践的 Harness Engineering 架构。
2. 将文章中的通用原则适配到 FrontierScan 的单仓库研发场景。
3. 记录当前实现、完成度、主要差距和后续优先级。
4. 为新的 Harness 设计、里程碑和代码审核提供防偏移检查依据。
5. 防止把文章没有要求的云平台能力误当成当前必需目标。

本文档不替代以下材料：

- `docs/harness-architecture-adaptation.md`：记录 FrontierScan 已有 Harness 结构和历史适配。
- `docs/harness-structure-checklist.md`：记录具体文件、脚本和里程碑交付情况。
- `docs/harness-m7-m12-roadmap/`：记录 M7-M12 已批准的总体设计、实施顺序、依赖和验收门禁。
- 各里程碑目录中的 `DESIGN.md`、`PLAN.md`、`REPORT.md`：记录具体实现过程。
- `.harness/states/` 与 `.harness/runs/`：记录当前运行事实和阶段证据。

发生冲突时，当前 Git、Harness State 和可重复验证结果优先于本文档中的进度快照；但新的架构方向必须以本文档的目标和边界为基准进行说明。

## 2. 参考文章的准确定位

参考文章记录的是腾讯应用宝活动平台团队在真实业务重构中开展的 Harness Engineering 实践。文章描述的主体不是通用云端 Agent 平台，而是两项相互依赖的工程能力：

```text
知识库工程
    ↓ 提供准确、结构化、可更新的业务上下文
端到端开发工程
    ↓ 驱动需求从分析到验证和交付
业务研发闭环
```

文章中的目标是把 AI 从局部编码助手提升为受工作流、状态、知识、角色和确定性工具约束的研发执行者。人在流程中主要负责业务澄清、关键决策、风险批准和必要的信息补全。

以下内容不是文章当前架构的核心组成部分，不应作为 FrontierScan 近期完成度的必选评分项：

- 云端控制面和数据面。
- 多租户资源调度。
- 弹性容器或大规模沙箱集群。
- 通用模型网关和计费平台。
- 无人值守的生产发布。

文章确实提出了工具解耦、自我评估、自我复盘和更强确定性编排等后续方向，但这些是文章团队仍在继续解决的问题，不能误认为已经完成的现状。

## 3. 为什么需要 Harness Engineering

文章总结了对话式 AI Coding 随项目复杂度增长产生的四类问题。

### 3.1 单窗口上下文膨胀

业务背景、代码规范、项目结构和历史决策不断增加，全部注入单次会话会快速消耗上下文。长会话还可能出现信息压缩、规则遗忘和行为漂移。

目标不是继续增加 Prompt，而是把长期知识、当前状态和执行结果移出对话上下文，保存为可按需加载的工程资产。

### 3.2 缺乏完整业务知识

一个需求可能跨越多个服务、接口、存储和业务流程。依赖人每次重新组织 Prompt，会导致高成本、信息遗漏和不可复用。

目标是建立能够由 AI 查询、由代码事实更新、由人工补充业务语义的结构化知识库。

### 3.3 缺乏完整工程闭环

编码只是研发的一部分。完整交付还包括需求拆解、方案设计、测试、审核、构建、测试环境发布、请求构造、接口验证和代码交付。

目标是让这些阶段进入统一工作流，并由状态文件和质量门禁控制推进。

### 3.4 单窗口无法有效并行

多个独立任务在单会话中只能串行执行；人工开启多个窗口又会增加协调、上下文同步和收口成本。

目标是在需求足够复杂时使用任务 DAG、隔离工作区和 Fork-Join 编排，在满足依赖和冲突约束的前提下并行执行。

## 4. 文章目标架构

### 4.1 知识库工程

知识库工程负责把散落在源码、文档和可观测系统中的工程知识转换为结构化、可检索、可增量更新的 AI 上下文。

#### 4.1.1 自动生成与人工沉淀并存

文章将知识分为两类：

- 自动生成知识：从代码、接口定义、依赖、存储和配置中提取事实。
- 人工知识：业务背景、跨服务流程、架构决策、历史约束、使用经验和避坑说明。

两类知识在查询时地位相同。自动刷新不能覆盖人工补充内容。

#### 4.1.2 分层目录和固定文档类型

文章采用总览层、业务域层和服务层的层次结构。服务知识包含总览、接口、架构、依赖、存储、配置、坑点和变更日志等固定类型，并通过 `meta.yaml` 记录服务索引、文档状态和代码版本。

这种结构的目的不是追求文档数量，而是让 Agent 能够先定位领域，再定位服务，最后只加载解决当前问题所需的文档类型。

#### 4.1.3 自动生成和增量融合

知识生成从服务入口和依赖关系出发，识别接口、调用关系和相关代码事实。已有文档更新时只修改代码变化影响的事实，保留人工说明，并追加可审计的变更记录。

文章还结合线上接口调用量判断接口是否活跃。该能力依赖其内部可观测平台，FrontierScan 只在未来出现真实需求和数据源时考虑适配。

#### 4.1.4 渐进式检索

文章采用分层加载和精确搜索，而不是默认把全部知识放入上下文：

```text
全局总览
-> 业务域或模块索引
-> 目标服务或模块
-> 与当前查询模式匹配的文档
-> 必要时核验源码
```

文章提供产品需求拆解、技术方案拆解、接口搜索和知识问答等模式。核心原则是按需加载、逐步探索和源码兜底。

#### 4.1.5 新鲜度闭环

文章强调“过期知识比没有知识更危险”。新鲜度机制比较知识生成基线与当前代码版本，超过阈值后生成刷新任务，并以增量模式更新文档和追加日志。

完整闭环应能够表达：

```text
检测差异
-> 标记 stale
-> 生成刷新任务
-> 执行增量生成
-> 验证知识
-> 更新基线和日志
```

### 4.2 状态驱动的端到端开发工程

文章使用状态文件驱动长流程，把跨阶段事实保存到磁盘，避免把聊天记录作为唯一上下文。

文章描述的主流程可以归纳为：

```text
需求拆解
-> 需求澄清
-> 任务拆解
-> 并行开发
-> 单元测试
-> 代码审查
-> 测试环境部署
-> 测试用例和请求构造
-> 接口验证
-> 代码提交
```

状态文件应当同时承担以下职责：

- 记录当前阶段和允许的下一阶段。
- 保存需求、澄清结果和验收标准。
- 保存任务、依赖、波次和预计修改范围。
- 保存测试、审核、构建、发布和验证结果。
- 保存阻塞原因、恢复条件和人工批准。
- 保存交付文件、提交结果和可追溯证据。
- 支持中断后从磁盘状态继续执行。

### 4.3 Agent 与 Skill

文章将复杂流程拆分给具有单一职责的专家 Agent，并通过 Skill 提供可复用的领域知识、执行规范和工具说明。

关键原则是：

- Agent 单一职责。
- 不同阶段使用隔离上下文。
- 每个 Agent 只获得当前任务需要的知识和权限。
- 子任务结果通过结构化产物交回主流程。
- 不允许子 Agent 越界接管主流程。

文章后续复盘也指出，依赖主 Agent 自己维持全局编排会出现指令依从性和流程失控问题。其演进方向是由外部程序控制全局流程，在需要认知时调用 AI，而不是继续增强一个无边界的主 Agent。

### 4.4 DAG、Worktree 与 Fork-Join

文章针对两种并行场景设计了不同机制：

- 单个 Story 内部：任务规划器构建 DAG，同一波次的独立任务进入不同 Worktree 并行开发，完成后串行集成。
- 一个产品需求包含多个 Story：先完成产品需求拆解，再 Fork 多个 Story 分别执行开发和审核，最后 Join 到统一发布、验证和交付流程。

冲突治理遵循：

```text
能事前隔离的就事前隔离
必须共享的就串行收口
```

共享入口、协议、数据库和配置等全局变化需要前置识别并集中处理，不能让多个 Agent 无约束地并行修改。

### 4.5 确定性脚本和外部编排

文章的核心工程原则是：

> AI 负责认知，脚本负责执行。

状态解析、工作区创建、构建、发布和知识初始化等确定性步骤不需要模型推理。将这些步骤脚本化可以降低 Token 消耗、减少随机性并提高可重复性。

文章进一步提出从以下模式：

```text
AI 串联流程
-> AI 在需要时调用脚本
```

演进为：

```text
外部程序串联流程
-> 程序在需要认知时调用 AI
```

文章团队在知识生成调度中还从 Shell 脚本演进到强类型程序，以降低长链路中的语法错误、边界错误和调试成本。FrontierScan 不需要机械复制其语言选择，但需要保留“确定性控制流属于程序”的原则。

### 4.6 DevOps 与真实环境闭环

文章将需求管理、协议修改、测试环境发布、配置管理、日志查询和代码审核平台接入工作流，使 AI 在人工确认后可以完成跨平台读写。

这一能力的本质要求是：

- 外部操作有明确工具接口。
- 读操作与写操作权限分离。
- 写操作在执行时获得人工批准。
- 发布、配置和提交结果写回状态。
- 环境不可用时记录真实阻塞，不能伪造验证通过。

FrontierScan 当前不要求无人值守发布，也不要求自动 Git 提交和推送。人工批准边界是当前目标的一部分，不是需要消除的障碍。

### 4.7 文章明确尚未解决的问题

文章将自身实践定位为从“能跑”向“跑得好”演进，并明确仍缺少：

- 流程执行后的自我复盘和自进化。
- 对稳定性、开发效果和 Token 成本的系统评估。
- Harness 工程与特定 AI Coding 工具的充分解耦。
- 更成熟的 Agent、Skill 和 Workflow 分层及插拔机制。

这些内容是 FrontierScan 的长期参考方向，不应被错误地当成文章已经交付的基准能力。

## 5. FrontierScan 的目标适配

FrontierScan 的近期目标不是复制腾讯内部平台，而是在当前单仓库中实现可靠的 Harness 风格业务开发闭环。

目标架构分为七层：

| 层级 | FrontierScan 目标 |
| --- | --- |
| 默认入口 | 通过 `AGENTS.md` 自动识别任务类型和 Harness 路由，用户只需描述业务目标 |
| 知识层 | 使用 `llm-knowledge/` 提供分层知识、查询、新鲜度和源码核验 |
| 状态层 | 使用 `.harness/states/` 保存完整、结构化、可恢复的 Story 事实 |
| 工作流层 | 使用 `.harness/workflows/` 定义阶段、产物、门禁和允许的状态转换 |
| 认知执行层 | Codex 或未来 Agent 负责需求、设计、实现、审核和诊断 |
| 确定性执行层 | `.harness/scripts/` 负责校验、状态推进、测试选择、构建规划和受控工作区操作 |
| 外部副作用层 | Git、发布、部署、外部服务写入继续由明确批准控制；完成前批准写入 State，完成后的 Git 事实写入独立版本化回执 |

## 6. 当前范围边界

当前已经确认的 Harness 验收目标是：

> 用户直接向 Codex 描述一个业务任务，Codex 能够按照项目 `AGENTS.md` 和 Harness 规则完成单个业务的需求、设计、实现、测试、审核、构建、验证和交付准备闭环。

当前必须具备：

- 单仓库。
- 单 Story。
- 当前会话串行执行。
- 用户不需要主动说明“请使用 Harness”。
- 业务开发默认采用 TDD。
- 中断后可以从 State 和阶段产物恢复。
- 测试、审核和环境阻塞必须真实记录。
- Git、发布、部署和外部写入保持批准门禁。

当前明确不要求：

- 自动执行 `git add`、`git commit` 或 `git push`。
- 自动创建 PR 或 MR。
- 无人值守发布和生产部署。
- 正式多 Agent 自动派发。
- 多 Story 自动 Fork-Join。
- 正式仓库中的多 Worktree 并行开发。
- 云端控制面、多租户或弹性沙箱平台。

延期能力不得阻塞当前单业务闭环，但相关设计不能破坏后续扩展所需的状态、权限和任务边界。

## 7. 当前实现对比

以下进度以 2026-08-21、实施基线 `b98a55a`、M7-D 与 M8-A 已完成闭环为基线。M8-A 已通过专项 fixture、真实 `codex exec` 审核、人工/Provider 对比和五项验收，并由提交 `ecc987e` 交付；当前尚未推送。

| 文章能力 | FrontierScan 当前证据 | 状态 | 估算完成度 |
| --- | --- | --- | ---: |
| 分层结构化知识 | `llm-knowledge/backend`、`frontend`、`common`、`index` | 已具备主体结构 | 75% |
| 自动知识生成 | `generate-kb.ps1`、`generate-kb.mjs`、内容指纹 | 已实现本地生成，语义层仍 pending | 65% |
| 渐进式知识查询 | `kb-query.ps1` 和多种查询模式 | 已可用于实际开发 | 75% |
| 知识新鲜度 | `check-kb-freshness.ps1`、`knowledge-runtime.mjs`、State v2 knowledge gate | relevant area 检查、最小刷新、不可变回执、重查恢复和逐项 stale 批准已由真实 Story 使用 | 88% |
| 单 Story 工作流 | `e2e-development-v2.yaml`、`M7-D-001` | 九阶段、阻塞恢复、受限返工和无 Git 完成均通过真实 Story | 96% |
| 状态运行时 | `run-state.ps1`、`state-runtime.mjs`、`story-runtime.mjs` | v2 初始化、原子投影、阻塞恢复、两类批准、审计、supersession 和完成门禁已通过真实 Story | 95% |
| 结构化 State 语义 | State v2、九阶段 result、`verify-story-closure.ps1` | 最终 State 可独立回答完整闭环事实；闭包核验器深检 result 内嵌证据并重算九阶段有效投影 | 96% |
| 专家角色和 Skill | 12 个 Agent 注册角色、13 个项目 Skill、M8-A `code-reviewer` Provider | 首个真实只读角色已接入；开发、测试和设计角色仍未开放 | 48% |
| 任务 DAG | DAG 1.0/2.0 Schema、验证器和 State 投影 | v2 节点成为唯一任务事实源并绑定 criterion；真实 Story 串行执行通过 | 78% |
| Worktree Wave | M5-A 至 M5-D Runtime 和测试 | Runtime 较完整，正式业务仍使用 Mock/fixture | 50% |
| 单测和代码审核 | 测试门禁、审核 Skill、M6-A/M7-D 审核记录、M8-A 真实 Provider | 真实 Provider 已发现并推动关闭身份、模型来源、隔离声明、恢复和超时竞态问题 | 94% |
| 构建和接口验证 | 构建结果、Chrome/API 证据、verification result | required criterion 已在真实 API/UI 环境全部 verified；自动环境编排仍待 M11 | 82% |
| Git 交付边界 | owned manifest、delivery preparation、独立 receipt | 业务文件归属、预测外修改、无 Git 完成和完成后回执语义已实现 | 86% |
| 外部 DevOps 集成 | 本地构建和 Docker 辅助能力 | 未接入完整测试环境和外部平台 | 20% |
| 评估和自进化 | 暂无稳定指标和自动复盘机制 | 未开始 | 10% |

### 7.1 综合判断

与文章已经实践的整体 Harness 工程相比：

```text
当前完成度约 86%～90%
剩余差距约 10%～14%
```

与 FrontierScan 当前限定的“单仓库、串行、单业务闭环、不自动 Git 交付”目标相比：

```text
当前完成度约 99%
剩余差距约 1%
```

这些比例是架构成熟度判断，不是精确项目管理工时。后续更新时必须同时提供实现证据，不能只修改百分比。

## 8. 已经验证有效的能力

M6-A 文章已读/未读状态业务证明当前 Harness 已经能够产生实际收益：

- 完整记录九个开发阶段和最终完成状态。
- 在 Git 操作前阻塞，并在用户批准后恢复。
- 通过审核发现并关闭请求竞态、失败反馈和 HTTP 测试不足等真实问题。
- 后端测试、前端构建、State 校验和 DAG 校验形成了可复核证据。
- 运行环境不可用时将 UI 验证记录为 blocked，没有伪造通过。
- 最终业务修改能够形成独立提交并推送到 `origin/dev`。

这说明当前问题不是“流程没有效果”，而是结构化事实、自动调度和机器可判定语义还没有充分利用。

## 9. 当前主要差距

### 9.1 State 完整验收事实链已由真实 Story 验证

M6-A 已经处于 `done/completed`，但以下字段仍为空或未正确收口：

```text
requirement.acceptanceCriteria
knowledge.loadedFiles
knowledge.staleFiles
tasks
dag.nodes
dag.edges
dag.waves
verification.cases
verification.results
delivery.ownedFiles
delivery.commit
```

M7-A2 至 M7-C 建立的阶段投影、criterion 追踪、知识闭环和交付语义已由 `M7-D-001` 真实 Story 验证。最终 State 为 `done/completed` revision `19`，`verify-story-closure.ps1` 仅读取 State 与绑定证据即可深检正式 result 链、重算有效投影，并输出需求、决策、知识、DAG、实现、测试、审核、构建、验证和交付事实。

M6-A 的 v1 历史空字段继续保持只读，不迁移、不改写；它不再代表新 v2 Story 的能力现状。

### 9.2 首个真实认知 Provider 已接入，其他角色仍由当前会话执行

当前实际模式是：

```text
Codex 读取 State
-> Codex 判断下一步
-> 普通认知阶段由 Codex 生成产物
-> code-review 阶段由 Codex 启动 Provider 链
-> Provider 独立审核
-> Runtime 生成正式证据和 result
-> Codex 调用 Apply 推进 State
```

文章的演进目标是：

```text
外部程序读取 State
-> 程序确定下一动作
-> 认知任务调用 AI
-> 确定性任务调用脚本
-> 结果自动回填 State
```

M7-B 已提供统一 `run-e2e Status/Step/Apply` 确定性入口，M7-D 证明新会话可从 State 恢复唯一下一动作。M8-A 进一步接入了可替换的真实 `code-reviewer` Provider：Runtime 冻结 request、context、权限和模型路由，本机 `codex exec` 在 `read-only` sandbox 中执行，Runtime 校验完整性后生成正式审核证据和 result。

当前审核执行本身已经具有实际自动化价值，但 `Prepare -> Run -> Materialize -> Apply` 仍由当前 Codex 会话按 Runtime 动作串联；`run-e2e Step` 不会自动执行完整 Provider 链，Agent 也不会自动修复 finding 或决定返工流程。详细评估见 `docs/harness-m8a-review-provider/AUTOMATION-ASSESSMENT.md`。

当前剩余差距是 requirement、design、developer、tester 等角色仍由当前 Codex 会话完成；M8-B 只计划开放单任务、单 Worktree、串行的开发 Provider，不允许 Provider 决定全局流程。

### 9.3 验证、知识和风险语义不完整

M7-A2 已能保存以下验证结果枚举：

```text
verified
accepted-with-known-gaps
blocked
failed
```

M7-A3 已使环境 blocked 不能伪装为 verified，并允许 required verification gap 在绑定当前 case、result、evidence 和用户理由的正式批准后进入 `accepted-with-known-gaps`。M7-C 已使 relevant stale/missing knowledge 只能在刷新为 fresh 或获得逐区域 `accepted-stale` 正式批准后推进；两类 approval 保持判别隔离。delivery remaining risk 的批准语义仍不在当前范围。

### 9.4 Agent Provider 仍只覆盖只读审核角色

`.codex/agents/agents.yaml` 仍只是角色注册表。M8-A 已证明真实 Codex Agent 能够以 `code-reviewer` 身份执行，但这不等于 12 个角色已经自动派发。M4/M5 Worker 的 Mock Provider 继续承担候选文件、Worktree 和并行协议 fixture，不应与真实只读 Provider 混淆。

真实 Agent 接入应建立在完整 State 和确定性调度器之上，不能通过让多个 Agent 自行协商来替代主控制流。

### 9.5 辅助脚本的剩余精度问题

已确认的问题包括：

- owned files、受控 manifest、交付对账和独立 receipt 已完成。
- 证据 semantic identity 已覆盖核心阶段与手工记录。
- M7-D 修复了纯控制区未跟踪文件参与复制身份折叠造成的大量无效 Git 子进程。
- `select-tests.ps1` 已识别运行态 DAG，但模块级定向测试推导仍较粗。
- `plan-build.ps1` 主要按路径判断，缺少迁移和 API 风险感知。

## 10. 已批准的 M7-M12 演进路线

完整设计和逐项实施计划保存在：

- `docs/harness-m7-m12-roadmap/DESIGN.md`
- `docs/harness-m7-m12-roadmap/PLAN.md`

M7-A1 至 M7-D 已完成 fixture 与真实 Story 验收。M8-M12 仍须逐项设计、审核和批准；M7 完成不构成自动启动 M8 的授权。

### 10.1 M7：单 Story 确定性闭环硬化

1. `M7-A1`：建立 State v2 契约和 v1 只读兼容。已实现并通过 fixture。
2. `M7-A2`：统一各阶段 `result.json`，由 Runtime 原子投影 State。已实现、通过 fixture，并在修复 4 个 BLOCKER 后通过第二轮独立只读代码审核。
3. `M7-A3`：建立验收项、DAG、测试和验证之间的可判定追踪门禁。已实现并通过 fixture；首轮审核问题修复后通过第二轮独立只读代码审核。
4. `M7-A4`：修复证据幂等、阻塞恢复、owned files 和交付语义。已实现并通过 fixture 与独立审核。
5. `M7-B`：增加最小确定性串行驱动器，不调用真实 Agent。已实现并通过九阶段纵向 fixture与最终独立只读审核。
6. `M7-C`：将任务相关知识新鲜度纳入 State、刷新和逐项接受门禁。已实现 relevant area 检查、可组合刷新回执、重查恢复和 `accepted-stale`，最终独立审核无 BLOCKER/WARNING。
7. `M7-D`：已通过异常 fixture 和 `M7-D-001` Dashboard 阅读状态真实 Story 完成双重闭环验收。

M7 完成后，仅读取最终 State 即可回答需求、决策、知识、DAG、修改、测试、审核、验证、缺口和交付准备事实；完成不要求 Git 提交。

### 10.2 M8：真实受限 Agent Provider

- `M8-A` 已接入只读 `code-reviewer` Provider，由 Runtime 控制输入、权限、超时、模型路由、结果校验和正式写入；真实 `codex exec` 与人工审核对比已通过。
- `M8-B` 在审核 Provider 验收后，接入单任务、单 Worktree、串行的 backend/frontend developer Provider。
- Provider 不决定全局流程，不直接写主 State，不越过 Git、发布和外部写入批准边界。

### 10.3 M9：条件式单 Story 并行

仅当同一 wave 至少存在两个无依赖、预测文件不冲突且无共享全局变化的任务时提出并行建议。用户批准正式 Worktree 操作后才执行；主树始终串行集成，不符合条件时保持串行。

### 10.4 M10：多 Story Fork-Join

当产品请求可拆为至少两个独立验收 Story 时，由 Harness 提出 Fork-Join 建议，用户确认后才创建产品级 State、Story 状态和集成资源。子 Story 独立推进，Join 阶段统一集成、构建、验证和交付准备。

### 10.5 M11：本地测试环境 DevOps 闭环

首版只覆盖本地 Docker Compose 测试环境。`build`、`up`、`down` 分别在执行时获得批准；环境不可用时记录 blocked，不访问生产环境或外部业务平台。

### 10.6 M12：评估与持续改进

从 M7 开始采集可追溯事件，累计至少 5 个真实 Story 后评估闭环成功率、失败与恢复、门禁发现、人工批准、accepted gap/stale 和越权情况。首版不强制 Token、费用和耗时统计，也不允许自动修改规则或代码。

### 10.7 通用启动门禁

- 专项设计获得用户批准。
- 计划不存在未决架构选择。
- Runtime 或 Schema 变更按 TDD 完成 fixture 验证。
- 相关回归、结构校验和差异检查通过。
- 独立只读审核无未解决 BLOCKER/WARNING。
- 每个对外宣称完成的主里程碑至少通过一次真实任务验收。
- 目标基线、结构清单、交接文档和知识状态同步。

## 11. 防偏移原则

以后新增或修改 Harness 能力时，设计文档必须回答以下问题。

### 11.1 目标对应

- 该能力对应本文档的哪一节？
- 它解决的是知识、状态、工作流、认知、确定性执行、验证还是外部副作用问题？
- 如果不对应参考文章，是否有 FrontierScan 的真实问题和用户批准作为依据？

### 11.2 简单优先

- 当前单业务闭环是否真的需要该能力？
- 能否复用现有 State、Workflow、Skill 或脚本？
- 是否在完整 State 和串行调度尚未稳定前，过早建设并行或平台能力？

### 11.3 事实与声明一致

- Agent 注册表不得描述为真实自动派发。
- Mock Worker 不得描述为正式 Agent 执行。
- fixture 中的 Git 或 Worktree 测试不得描述为正式仓库验收。
- 报告存在不等于结构化 State 已完整回填。
- 环境不可用不得描述为接口或 UI 已验证。
- 脚本给出建议不等于脚本已经执行操作。

### 11.4 安全边界

以下操作继续要求逐次明确批准：

- `git add`
- `git commit`
- `git push`
- PR 或 MR 创建
- 发布和部署
- 外部服务写入
- 正式 Worktree 创建或回收
- 分支删除和破坏性文件操作

不得为了追求文章中的“自动闭环”而弱化这些边界。文章本身也强调跨平台写操作需要人工确认。

### 11.5 优先级判定

默认优先级为：

```text
结构化 State 完整性
-> 单 Story 确定性串行调度
-> 知识新鲜度闭环
-> 真实 Agent Provider
-> 单 Story 并行
-> 多 Story Fork-Join
-> 外部 DevOps 集成
-> 自动评估和自进化
```

只有新的业务证据或用户决策才能调整该顺序。

## 12. 里程碑完成后的更新规则

完成影响 Harness 架构的里程碑后，必须更新本文档：

1. 更新文档日期和项目基线提交。
2. 更新第 7 节的证据、状态和完成度。
3. 从第 9 节删除已经真正关闭的差距。
4. 更新第 10 节优先级，不保留已经失效的“下一步”。
5. 记录新发现但尚未解决的架构问题。
6. 区分“实现完成”“fixture 验证”“正式业务验收”三种状态。
7. 运行：

```powershell
.\.harness\scripts\validate-structure.ps1
git diff --check
```

完成度调整必须附带至少一种证据：

- 可执行脚本及测试。
- 通过校验的结构化 State。
- 正式业务闭环报告。
- 真实环境验证结果。
- Git 提交或阶段回执。

## 13. 当前架构决策摘要

截至 2026-08-21，FrontierScan Harness 的正式方向为：

1. 继续以“知识库工程 + 端到端开发工程”为总体结构。
2. 以 `AGENTS.md` 作为用户自然语言任务的默认入口。
3. 以结构化 State 作为长流程唯一事实源，不依赖聊天历史恢复。
4. AI 负责认知，脚本和外部程序负责确定性执行。
5. 先完成单 Story 串行闭环，再考虑真实 Agent 和并行。
6. 不把 Agent 数量、文档数量或脚本数量当作主要成功指标。
7. 以能否稳定完成真实业务、发现问题、记录缺口并安全恢复作为验收标准。
8. 不将云平台、多租户和无人值守发布纳入当前目标。
9. Git、发布、部署和外部写操作继续由用户明确批准。
10. `done/completed` 表示业务开发和交付准备完成，不表示已经提交或推送。
11. 完成后的 Git 事实进入独立版本化 `delivery-receipt.json`，不得修改 completed State。
12. State v2 移除顶层 `tasks`，以 `dag.nodes` 作为唯一任务事实源；State v1 只读兼容且不迁移。
13. 每个 v2 阶段使用统一结构化 `result.json`，Markdown 不作为 Runtime 的核心事实解析源。
14. `accepted-with-known-gaps` 和 `accepted-stale` 必须逐项获得用户批准并绑定理由与证据。
15. M8 首个真实 Provider 为只读 `code-reviewer`；并行、Fork-Join 和本地 Docker Compose 闭环按 M9-M11 依次推进。
16. M7-A3 已实现稳定 criterion、DAG/test/verification 覆盖和 `verification-gap` 逐项批准。
17. M7-A4 已通过 fixture、兼容回归和独立审核，实现 record 语义幂等、actual-only owned 推导、受控 manifest、delivery apply 对账和独立 delivery receipt。
18. M7-B 已实现 Story Runtime 只读 inspection、完整阶段 preflight 与 `run-e2e.ps1 Status/Step/Apply`，九阶段纵向 fixture 使用统一入口完成到 `done`，最终独立审核无 BLOCKER/WARNING。
19. M7-C 已实现 relevant knowledge area 检查、当前 source fingerprint 门禁、受控 recheck、最小刷新、三域 common 保护、可组合不可变刷新证据和逐区域 `accepted-stale`。
20. M7-D 已通过异常 fixture 和真实 Story；最终 State 为 `done/completed` revision `19`，五项 required criterion 均为 `verified`，交付准备未执行 Git。
21. late-stage rework 仅允许未完成 State v2 从 blocked `delivery-preparation` 回到 `implementation`，历史结果通过 supersession 保留；不支持任意回退。
22. 最终闭环核验器对正式证据使用固定目录白名单，对构建产物使用仓库内非 `.git` 普通文件边界；两类路径不得混用。
23. M8-A 已实现 `role -> profile -> adapter/model` 配置、项目默认与本地覆盖、严格 Provider request/context/response/receipt 契约，以及本机 `codex exec` 只读审核闭环。
24. M8-A 的 `readIsolation=same-os-user-readonly-sandbox` 只声明同一操作系统用户下的写入限制，不声称严格文件读取 ACL。
25. 未指定模型时，`codex-cli` 不传 `--model`；需要严格复现模型时必须显式配置。模型路由不得改变角色权限、上下文或固定 CLI 参数。
26. M8-A 已完成 `M8-A-001` 九阶段闭环，最终 State 为 `done/completed` revision `51`，五项 required criterion 均为 `verified`，交付准备未执行 Git。
27. 下一优先项为经用户批准后设计 M8-B 单任务开发 Provider。
