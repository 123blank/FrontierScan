# M4-A Codex 运行时兼容性需求拆解

## 来源需求

验证本机 Windows Codex CLI 新会话能否稳定发现 FrontierScan 的 13 个 `frontier-*` Skill，并形成项目级 Skill/Plugin 加载方式以及 12 个 Agent 角色到未来 Worker 的映射结论。

## 假设与边界

- 正式验收目标是本机 `Codex CLI`，桌面端和 IDE 不属于本 Story 的强验收范围。
- 使用 `codex debug prompt-input` 检查新会话模型可见上下文，不调用真实模型。
- M4-A 只修改 Harness 证据和中文文档，不修改 backend、frontend 或数据结构。
- 不实现 Worker、多 Agent、Worktree、任意命令、发布、部署或 Git 自动交付。
- 当前知识索引为 fresh；具体运行时结论以 CLI 实际输出和官方文档为准。

## 开放问题

无。Skill 路径选择按可重复实验的确定性决策规则得出，不在取证前猜测迁移。

## 影响范围

| 区域 | 影响 | 说明 |
| --- | --- | --- |
| `.codex/skills/` | 只读检查 | 校验 13 个 Skill 的发现、目录、名称、描述和注册表映射 |
| `.codex/agents/` | 只读检查 | 校验 12 个角色及未来 Worker 权限映射 |
| `.harness/` | 新增证据 | 保存本 Story 阶段产物、测试和审核报告 |
| `docs/` | 更新 | 新增 M4-A 设计、计划、报告并同步交接说明 |
| backend/frontend | 无 | 不修改源码，不运行不必要的业务构建 |

## Story

### M4-A-001 - 验证 Codex 项目运行时兼容性

- 用户价值：为 M4-B 受约束 Worker 开发提供已验证的 Skill 加载机制和角色权限边界，避免基于未确认的 Codex 行为开发。
- 新增或变更行为：无业务行为变更；新增可审计的兼容性结论和后续 Worker 映射建议。
- 验收标准：
  - [ ] 连续 3 次仓库内新 prompt context 均发现完全一致的 13 个 `frontier-*` Skill。
  - [ ] 仓库外负向对照不发现 FrontierScan 项目 Skill。
  - [ ] 13 个 Skill 目录、frontmatter 与 `skill-registry.yaml` 一一对应。
  - [ ] 12 个 Agent 角色被完整盘点，并形成未来 Worker 的最小权限映射。
  - [ ] 对 `.codex/skills`、`.agents/skills` 和 Plugin 给出有证据的选择结论。
  - [ ] 最终审核无影响稳定性、可用性或近期扩展的未解决 `BLOCKER/WARNING`。
- 风险：Codex CLI 后续版本可能改变加载路径；桌面端、IDE 和非 Windows 平台未纳入强验收，作为延期边界记录。
- 测试提示：CLI prompt context 正负对照、结构校验、Harness Smoke、知识新鲜度、no-build 和文档一致性检查。

