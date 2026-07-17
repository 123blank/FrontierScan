# M4-A Codex 运行时兼容性技术设计

## 1. 设计目标

使用本机 Codex CLI 的模型可见 prompt context 验证项目 Skill 发现，不启动模型、不依赖网络，也不把当前对话中已加载的 Skill 列表当作唯一证据。验证结果必须能区分项目级发现、用户级安装和 `AGENTS.md` 文本提及。

## 2. 事实来源

| 事实 | 权威来源 |
| --- | --- |
| CLI 版本 | `codex.cmd --version` |
| 新会话可见 Skill | `codex.cmd debug prompt-input` 输出中的 `<skills_instructions>` |
| 项目级来源 | 仓库内正向检查与仓库外负向对照的差异 |
| Skill 定义 | `.codex/skills/frontier-*/SKILL.md` frontmatter |
| Skill 登记 | `.codex/skills/skill-registry.yaml` |
| Agent 角色 | `.codex/agents/agents.yaml` |
| 工作流实际 owner | `.harness/workflows/e2e-development.yaml` |
| 产品机制 | OpenAI 官方 Codex Skill、Plugin、配置和 Subagent 文档 |

## 3. Skill 发现验证

每次 `debug prompt-input` 都解析 JSON 数组，定位内容以 `<skills_instructions>` 开头的 developer input，再只匹配 `### Available skills` 下形如 `- frontier-...:` 的条目。不得扫描完整输出中的任意 `frontier-*` 文本，否则会把用户提供的 `AGENTS.md` 路由表误计为运行时 Skill。

正向验证连续运行三次，每次必须满足：

- 发现数量为 13，名称无重复。
- 名称集合与 `skill-registry.yaml` 完全一致。
- 每个 locator 位于当前仓库 `.codex/skills/<name>/SKILL.md`。
- 三次集合和 locator 均一致。

负向验证通过 CLI 顶层 `-C` 切换到仓库外临时目录，使用同样解析规则，要求不出现任何 `frontier-*` Skill。负向结果用于证明正向发现不是用户级全局安装。

## 4. 路径和 Plugin 决策

1. 当前 `.codex/skills` 三次正向和一次负向均通过时，保留现有结构。
2. 当前路径失败时，只在临时仓库复制最小 Skill fixture 到 `.agents/skills` 后复测，不直接迁移正式目录。
3. 临时新路径通过时输出迁移提案并暂停；两种路径均失败时阻塞。
4. Plugin 是跨仓库、团队安装或组合 MCP/Hook 的分发单元，当前单仓库 Skill 不为未来分发预先打包。

## 5. Agent 映射设计

M4-A 只输出映射建议，不把 `.codex/agents/agents.yaml` 宣称为运行中 Agent。映射覆盖全部 12 个角色，至少记录：角色分类、当前写权限、当前工作流是否引用、未来 Worker 的业务源码写边界、禁止能力和可能的 Codex `agents.<name>.config_file` 对应关系。

通用约束：

- review/verification 角色不得修改业务源码，只能产生当前 phase 报告；`unit-tester` 的测试源码权限需与业务源码分开。
- planning 角色不得执行发布或 Git 交付。
- publisher/git-committer 在 M4 仍只能产生报告，真实外部动作继续依赖用户批准和后续里程碑。
- M2/M3 继续独占状态推进、adapter 和证据门禁。

## 6. 证据与审核

CLI 取证保存为脱敏 JSON，只保留 CLI 版本、运行序号、工作目录类型、Skill 名称、locator 和断言结果，不保存认证信息或完整系统 prompt。官方资料记录 URL、访问日期和与本项目相关的结论。

最终审核只检查本 Story owned diff，重点发现错误结论、误计数、无效负向对照、文档矛盾、范围越界和无法复现的命令。现实可复现的 `BLOCKER/WARNING` 必须修复并重跑；桌面端/IDE、未来 CLI 版本和非 Windows 平台作为低概率延期边界记录。

