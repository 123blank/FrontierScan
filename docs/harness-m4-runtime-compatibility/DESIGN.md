# FrontierScan Harness M4-A Codex 运行时兼容性设计

> 日期：2026-07-17
> Story：`M4-A-001`
> 目标运行时：Windows `codex-cli 0.144.1`

## 1. 目标

M4-A 在不调用真实模型、不修改业务源码的前提下，验证新 Codex CLI prompt context 能否稳定发现 FrontierScan 的 13 个项目 Skill，并为 M4-B 设计 12 个 Agent 角色的受约束 Worker 映射。

本阶段只验证运行时兼容性，不实现 Worker、多 Agent、Worktree、发布、部署或 Git 自动写入。

## 2. 验证模型

```text
仓库内 cwd
  -> codex debug prompt-input
  -> 只读取 <skills_instructions>/Available skills
  -> 13 个 frontier-* 名称和 locator

仓库外 cwd
  -> 相同命令和解析规则
  -> 0 个 frontier-* Skill
```

三次仓库内检查用于验证稳定性；仓库外检查用于排除用户级重复安装。完整 prompt 不落盘，证据只保留名称、locator 规则、数量和断言结果。

## 3. 兼容性决策

- 当前 CLI 三次均从 `.codex/skills/<name>/SKILL.md` 暴露 13 个 Skill，负向对照为 0，因此本项目保留 `.codex/skills`。
- OpenAI 当前文档推荐仓库 Skill 使用 `.agents/skills`。本结论是对目标 CLI 版本的实测兼容性结论，不扩展为所有 Codex 表面的永久保证。
- 只有 CLI 升级或新增 IDE/桌面端强验收且当前路径失败时，才在临时仓库验证 `.agents/skills` 并另行提出迁移。
- Plugin 适合跨仓库/团队安装或组合 MCP、Hook 的分发，不是当前单仓库运行时的必要依赖。

## 4. Agent 映射原则

`.codex/agents/agents.yaml` 继续是 12 个角色的职责注册表，不是活动 Worker。M4-B 应为每个角色建立受 Schema 校验的运行时策略，并遵循：

- planning 角色不能修改业务源码、发布或执行 Git 交付。
- review 和 verification 角色不能修改生产源码；报告由受控编排器落盘。
- backend/frontend 执行角色只能写各自 task-owned 范围。
- publisher/git-committer 在 M4 仍不能直接产生外部状态变更。
- M2/M3 继续独占状态推进、固定 adapter、证据复核和质量门禁。

官方 Custom Agent 能声明 `name`、`description`、`developer_instructions`，并组合 model、sandbox、MCP 和 Skill 设置；这些是 M4-B 策略映射的候选运行时载体，不在 M4-A 创建。

## 5. 稳定性边界

M4-A 使用 CLI 自带的 prompt 调试入口，不新增 loader、Plugin 或依赖，减少维护面。Skill 目录、frontmatter、注册表和运行时发现必须四方一致；任何一方缺失都不能进入 M4-B。

桌面端、IDE、非 Windows 平台和未来 CLI 版本属于延期验证项，不阻塞当前目标 CLI 的结论。
