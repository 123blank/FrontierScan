# M4-A 实施记录

## 完成内容

- 初始化并推进 `M4-A-001` 的 requirement、technical-design 和 task-dag 阶段。
- 使用 `codex-cli 0.144.1` 连续执行三次仓库内 `debug prompt-input`，每次发现相同的 13 个项目 Skill。
- 在仓库外临时目录执行负向对照，发现 0 个 `frontier-*` Skill。
- 校验 13 个 Skill 目录、frontmatter、描述、注册表名称和路径全部一致。
- 校验 Agent 注册表包含 12 个角色，E2E workflow 使用的 8 个 owner 全部存在。
- 对照 OpenAI 官方 Skill、Plugin、项目配置和 Custom Agent 文档，决定当前保留 `.codex/skills`，不引入 Plugin。
- 输出 12 个角色到未来受约束 Worker 的最小权限映射，不启动 Worker。
- 新增 M4-A 设计、计划和报告，并同步项目交接、架构适配和结构清单。

## TDD 修复

中文任务 DAG 在 Windows PowerShell 下暴露默认代码页读取问题：

1. 新增 `task-dag.test.ps1`，使用 Unicode code point 生成 UTF-8 中文 DAG。
2. 首次有效 RED 复现 `validate-task-dag.ps1` JSON 解析失败。
3. 给校验器增加 `-Encoding UTF8` 后，测试继续在 `plan-worktrees.ps1` 失败。
4. 修复 Worktree 计划读取后，测试继续在 `derive-interface-cases.ps1` 失败。
5. 修复第三个消费者后测试 GREEN，并确认中文标题和验收标准保持原值。
6. 真实 M4-A DAG 随后通过 4 节点、3 边、4 波次校验。

## 证据

- `evidence/skill-discovery.json`
- `evidence/registry-check.json`
- `evidence/official-runtime-sources.json`
- `evidence/agent-runtime-mapping.json`

## 范围确认

- 未修改 backend 或 frontend 业务源码。
- 未调用真实模型、未创建 Plugin、未启动 Agent/Worker。
- 未执行发布、部署、Git 写入、PR、Worktree 或分支操作。

