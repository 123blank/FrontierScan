# FrontierScan Harness M4-A 实施计划

> 执行约束：按 T1-T4 串行完成；不调用真实模型，不修改 backend/frontend，不执行 Git 写入、发布、部署或 Worktree 操作。

## T1：固化兼容性方案

- [x] 初始化 `M4-A-001`，确认 `M3-001` 已完成且没有被覆盖。
- [x] 保存 requirement、technical-design 和四任务串行 DAG。
- [x] 定义三次正向、一次负向、注册表一致性和官方资料决策规则。

## T2：完成运行时取证

- [x] 记录 `codex-cli 0.144.1` 和当前仓库 HEAD。
- [x] 连续三次解析新 prompt context 的 `<skills_instructions>`，每次得到唯一的 13 个项目 Skill。
- [x] 在仓库外目录执行负向对照，得到 0 个项目 Skill。
- [x] 校验 13 个目录、frontmatter、描述、注册表名称和路径一致。
- [x] 校验 12 个 Agent 角色以及当前工作流引用的 8 个 owner 均存在。
- [x] 对照官方 Skill、Plugin、配置和 Custom Agent 文档。

## T3：形成结论并同步文档

- [x] 保留当前 `.codex/skills`，不新增 `.agents/skills` 副本或 Plugin。
- [x] 输出 12 角色未来 Worker 权限边界和 Codex 映射建议。
- [x] 完成实施报告、交接文档、架构说明和结构清单同步。

## T4：验证与审核

- [x] 发现并以 TDD 修复三个 DAG 消费脚本的 Windows PowerShell UTF-8 读取问题。
- [x] 运行测试选择器、UTF-8 DAG 回归、结构校验、Smoke、知识新鲜度和 no-build 检查。
- [x] 对 owned diff 做只读审核；未发现未解决的 `BLOCKER/WARNING`。
- [x] 保存最终验证和审核证据，不执行提交、推送或发布。
