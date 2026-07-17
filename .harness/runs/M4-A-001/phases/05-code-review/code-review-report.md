# M4-A Codex 运行时兼容性审核报告

## 审核范围

- M4-A 需求、技术设计、任务 DAG、实施记录和兼容性证据。
- 三次仓库内 Skill 发现、仓库外负向对照、13 个 Skill 注册一致性和 12 个 Agent 角色映射。
- `validate-task-dag.ps1`、`plan-worktrees.ps1`、`derive-interface-cases.ps1` 的 UTF-8 读取修复及 `task-dag.test.ps1` 回归。
- 项目交接、Harness 架构、结构清单和结构清单契约更新。
- backend/frontend 差异边界和 M4-A 排除范围。

## 发现

未发现未解决的 `BLOCKER` 或 `WARNING`。

## 审核证据

- Windows `codex-cli 0.144.1` 的三次仓库内 prompt context 均发现同一组 13 个 `frontier-*` Skill，locator 均位于当前仓库 `.codex/skills`。
- 仓库外负向对照发现 0 个 FrontierScan Skill，排除了用户级重复安装导致的假阳性。
- 13 个 Skill 目录、frontmatter、描述和 `skill-registry.yaml` 一致；12 个 Agent 角色完整，E2E workflow 的 8 个 owner 均存在。
- OpenAI 当前文档推荐仓库 Skill 使用 `.agents/skills`；目标 CLI 实测仍稳定支持现有 `.codex/skills`，因此保留当前结构并把 CLI 升级或新增表面作为复验条件。
- UTF-8 修复仅在三个共享 DAG JSON 输入边界增加 `-Encoding UTF8`，没有引入新依赖或修改业务逻辑。
- 回归测试使用真实 UTF-8 中文 JSON，同时验证校验、Worktree 计划和接口用例派生保留中文内容。
- 当前 owned diff 不包含 `backend/src/**` 或 `frontend/src/**`。

## 剩余验证边界

- 桌面端、IDE、Linux/macOS 和未来 CLI 版本未纳入本 Story 强验收，已记录为延期边界。
- 未调用真实模型，也未实现 Worker、多 Agent、Worktree 执行、发布、部署或 Git 自动写入。
- 最后一轮结构、Smoke、状态、知识、差异和 no-build 门禁在进入 Git 交付前重新执行并单独记录。

## 结论

审核通过。当前没有会影响稳定性、基本可用性或近期扩展的未解决问题，可以进入 `build-publish` 的 no-build 判定阶段。
