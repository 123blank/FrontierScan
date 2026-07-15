# Codex 项目规范

用于减少常见大模型编码错误的行为规范。执行任务时，应与项目专用规则合并使用。

## 1. 编码前先思考

**不要假设，不要隐藏疑问，明确说明权衡。**

实现前：

- 明确说明假设；存在不确定性时先询问。
- 存在多种解释时列出差异，不要静默选择。
- 存在更简单的方案时主动说明，必要时提出异议。
- 需求不清楚时停止实现，指出具体疑问并询问。
- 业务开发优先采用 TDD；只有明确判断 TDD 不适用时，才采用其他合适方法。

## 2. 简单优先

**只编写解决当前问题所需的最少代码，不进行推测性扩展。**

- 不实现需求范围外的功能。
- 不为单次使用创建抽象层。
- 不增加未被要求的灵活性或配置能力。
- 不为不可能发生的场景增加错误处理。
- 如果 200 行代码可以缩减到 50 行，应重新简化。

自检问题：资深工程师是否会认为这个实现过度复杂？如果答案是肯定的，应继续简化。

## 3. 最小范围修改

**只修改必要内容，只清理本次修改产生的问题。**

编辑现有代码时：

- 不顺带改进相邻代码、注释或格式。
- 不重构没有问题的代码。
- 遵循现有代码风格，即使个人偏好不同。
- 发现无关的废弃代码时只进行说明，不要删除。

如果本次修改产生了无用内容：

- 删除由本次修改造成的无用导入、变量或函数。
- 除非用户明确要求，否则不删除原有废弃代码。

判断标准：每一处修改都应能够直接追溯到用户需求。

## 4. 目标驱动执行

**定义可验证的成功标准，并循环执行直到验证通过。**

将任务转换为可验证目标：

- “增加校验”转换为“先为非法输入编写测试，再让测试通过”。
- “修复问题”转换为“先编写可复现问题的测试，再让测试通过”。
- “重构某模块”转换为“确保重构前后测试均通过”。

多步骤任务应先给出简短计划：

```text
1. [步骤] -> 验证：[检查方法]
2. [步骤] -> 验证：[检查方法]
3. [步骤] -> 验证：[检查方法]
```

清晰的成功标准支持自主迭代；“让它能工作”之类的模糊目标需要先澄清。

## 5. 文档语言规范

- 项目新增或更新的计划、报告、交接文档、复盘、方案和说明默认使用中文。
- 不在同一段说明中无必要地混用中英文；已有中英混杂内容在本次任务涉及范围内应统一改为中文。
- 命令、路径、环境变量、API 字段、模型标识、状态值、代码标识符、文件名和官方专有名称保留原文，必要时补充中文解释。
- 引用程序原始输出时可以保留原文，但必须提供中文上下文或结论。

## 6. Harness 结构规范

FrontierScan 正在参考腾讯相关文章向 Harness Engineering 工作流演进。

当前结构区域：

- `.harness/`：工作流状态、结构定义、工作流、报告、模板和确定性脚本。
- `.codex/agents/`：规划中的专家 Agent 注册表。
- `.codex/skills/`：项目本地 Skill 脚手架。
- `llm-knowledge/`：供 AI 消费的结构化项目知识。
- `docs/`：面向开发人员的业务计划、报告、Harness 方案和检查清单。

处理 Harness 结构时：

- 将 `.harness/states/` 视为工作流状态，而不是源码。
- 将 `llm-knowledge/` 视为自动生成或人工维护的 AI 知识。
- Skill 和 Agent 脚手架必须与运行时状态分离。
- 未经用户明确批准，不得实现或执行发布、推送、提交及破坏性 Git 自动化。
- 不修改无关的业务文件。
- 修改 Harness 结构后运行 `.\.harness\scripts\validate-structure.ps1`。

## 7. FrontierScan Harness 默认入口规则

当 Codex 在 `D:\ProjectStudy\FrontierScan` 中工作时，将本文件作为 Harness 风格 AI 编码的默认操作入口。

每个任务开始时先分类：

- `question`：按需从本地文档、`.harness/`、`.codex/skills/`、`llm-knowledge/` 和源码中查找答案，不修改文件。
- `harness-structure`：只更新 Harness、Skill、Agent、状态、工作流、模板、文档或知识脚手架。
- `business-implementation`：检查相关知识和当前工作流状态后，才修改后端、前端或产品代码。
- `review`：先检查差异并报告发现；除非用户明确要求修复，否则不修改文件。
- `test-or-verification`：选择并运行范围最小且有效的测试或验证命令，然后报告证据。
- `delivery`：总结本任务修改；执行暂存、提交、推送、发布或创建 PR 前必须获得明确批准。

对于非简单实现任务，修改文件前先说明当前工作流阶段和成功标准。

## 8. 知识优先开发

广泛阅读源码前，优先使用 `llm-knowledge/` 获取项目知识。

进行需求分析、设计、实现、审核或验证前：

- 当任务依赖现有项目知识时，使用 `.harness\scripts\check-kb-freshness.ps1` 检查知识新鲜度。
- 使用 `.harness\scripts\kb-query.ps1` 查询相关知识。
- 知识缺失或过期时必须明确说明，并以源码核验后再做决定。
- 完成知识查询后优先阅读目标源码，避免加载无关模块。
- 更新生成知识时保留 `llm-knowledge/**/custom/` 下的人工记录。

推荐查询模式：

- 需求拆解：`-Mode requirement-breakdown`
- 技术设计：`-Mode technical-design`
- API 查询：`-Mode api-search`
- 前端界面和组件查询：`-Mode frontend-ui-search`
- 数据流追踪：`-Mode data-flow-trace`
- 通用项目问题：`-Mode knowledge-qa`

## 9. 项目 Skill 路由

项目本地 Skill 位于 `.codex/skills/`。

如果当前 Codex 运行时提供匹配的 `frontier-*` Skill，应正常调用。如果运行时未提供，则手动读取对应项目本地 `SKILL.md`，并且只读取与当前任务直接相关的参考资料。

路由映射：

- 通用项目规范：`frontier-common`
- 生成或刷新结构化知识：`frontier-kb-generate`
- 查询结构化知识：`frontier-kb-query`
- 检查知识过期状态：`frontier-kb-refresh-check`
- 拆解产品或工程需求：`frontier-requirement-breakdown`
- 规划任务、依赖和并行批次：`frontier-task-dag-planner`
- 读取、校验、恢复或更新工作流状态：`frontier-state-runner`
- 规划隔离工作树：`frontier-worktree-orchestrator`
- 选择或运行测试：`frontier-test-gate`
- 审核代码修改：`frontier-code-review-gate`
- 推导或运行 API、界面验证用例：`frontier-interface-verifier`
- 规划构建或发布步骤：`frontier-build-publish`
- 准备交付、提交或 PR 摘要：`frontier-git-delivery`

当前项目本地 Skill 只是指导脚手架，除非它们出现在当前运行时可用 Skill 列表中，否则不得声称运行时会自动触发这些 Skill。

## 10. Agent 注册表使用规则

`.codex/agents/agents.yaml` 是角色和职责注册表，不是正在运行的 Agent 运行时。

使用以下角色视角处理任务：

- `product-analyst` 和 `requirement-analyst`：需求拆解和验收标准。
- `task-planner`：任务 DAG 和依赖规划。
- `backend-developer` 和 `frontend-developer`：功能实现。
- `unit-tester`、`test-case-designer` 和 `interface-verifier`：验证。
- `code-reviewer`：只读代码审核。
- `publisher` 和 `git-committer`：需要用户批准的交付操作。

除非存在真实的运行时调度机制，否则不得声称 Agent 已经自动派发。

## 11. Harness 工作流触发规则

普通功能或缺陷修复使用 `.harness/workflows/e2e-development.yaml` 中的单业务工作流：

```text
requirement -> technical-design -> task-dag -> implementation -> unit-test -> code-review -> build-publish -> interface-verification -> git-delivery -> done
```

当一个用户请求自然拆分为多个相互独立的业务时，使用 `.harness/workflows/product-fork-join.yaml`：

```text
breakdown -> forking -> joining -> done
```

触发要求：

- 新的模糊产品需求：实现前先创建或更新需求拆解。
- 跨模块修改：实现前先创建或更新任务 DAG。
- 存在有效的活动状态文件：继续工作前先读取并遵守该状态。
- 前端界面修改：遵循现有前端模式以及仓库中存在的 B2B 后台界面规范。
- 后端或数据修改：运行更广泛构建前，优先使用针对性后端测试。
- 审核、测试、构建或交付阶段：将证据写入 `.harness/reports/`；不写文件时向用户清晰总结。

## 12. Harness 必需检查

修改 Harness 资产后运行相关的确定性检查：

- 修改结构、Skill、Agent、文档或知识脚手架：`.\.harness\scripts\validate-structure.ps1`
- 修改状态文件：`.\.harness\scripts\validate-state.ps1 -StateFile <state-file>`
- 修改任务 DAG：`.\.harness\scripts\validate-task-dag.ps1 -TaskDagFile <dag-file>`
- 查询知识：`.\.harness\scripts\kb-query.ps1 -Query "<keywords>" -Mode <mode> -Area <area>`
- 检查知识过期状态：`.\.harness\scripts\check-kb-freshness.ps1`
- 获取测试建议：`.\.harness\scripts\select-tests.ps1`
- 获取构建建议：`.\.harness\scripts\plan-build.ps1`
- 获取交付摘要：`.\.harness\scripts\summarize-delivery.ps1`
- 执行非破坏性冒烟验证：`.\.harness\scripts\smoke-harness-flow.ps1`

这些脚本只是辅助工具，不能替代源码审核、真实测试，也不能替代用户对外部状态变更操作的批准。

## 13. 批准与安全边界

未经用户明确批准，不得执行：

- `git add`、`git commit`、`git push`、创建 PR、打标签、发布或部署。
- 破坏性 Git 操作或文件系统清理。
- 删除工作树或分支。
- 修改外部服务、生产数据或部署环境的命令。

交付前必须区分本任务修改和无关工作区修改。不得还原或覆盖无关修改。

## 14. 与阶段匹配的代码审核

代码审核范围应与项目当前阶段相匹配。当前目标是保证基本可用和合理可扩展，而不是对每个理论场景进行穷尽式加固。

- 报告可能破坏主流程、违反正确性或安全性、损坏数据，或者形成明确近期扩展障碍的问题。
- 优先报告能够复现，并且在修改代码中有具体证据的问题和风险。
- 不将低概率假设、推测性未来需求、轻微风格偏好或过早加固列为问题。
- 不因非必要改进阻塞交付。只有剩余风险会实质影响当前决策时才进行说明。
- 优先提供少量可执行问题，不进行所有可能问题的穷举。
