# FrontierScan Harness M4-A Codex 运行时兼容性报告

> 日期：2026-07-17
> Story：`M4-A-001`
> 当前结论：目标 CLI 兼容性和 Harness 门禁通过，Git 交付已获用户批准，Story 状态为 `done`

## 1. 业务结论

本机 Windows `codex-cli 0.144.1` 在 FrontierScan 仓库内连续三次生成的新 prompt context 中，均发现完全一致的 13 个 `frontier-*` Skill；所有 locator 均指向当前仓库 `.codex/skills/<name>/SKILL.md`。仓库外负向对照发现数量为 0，排除了用户级重复安装造成的假阳性。

因此 M4-A 选择保留 `.codex/skills`，不迁移、不复制、不引入 Plugin。该结论只保证已记录 CLI 版本和 Windows 环境；官方当前推荐 `.agents/skills` 的差异作为升级复验条件保留。

## 2. 验证结果

| 检查 | 结果 |
| --- | --- |
| CLI 版本 | `codex-cli 0.144.1` |
| 正向运行 1 | 13 个、13 个唯一、locator 全部正确 |
| 正向运行 2 | 13 个、13 个唯一、与运行 1 一致 |
| 正向运行 3 | 13 个、13 个唯一、与运行 1/2 一致 |
| 仓库外负向对照 | 0 个项目 Skill |
| Skill 目录/frontmatter/注册表 | 13/13 一致，描述均非空 |
| Agent 注册表 | 12 个角色 |
| E2E workflow owner | 8 个，全部存在于 Agent 注册表 |
| 真实模型调用 | 未执行 |

结构化证据位于 `.harness/runs/M4-A-001/phases/03-implementation/evidence/`。

## 3. 官方机制对照

| 机制 | 官方资料 | 本项目结论 |
| --- | --- | --- |
| Skill | 仓库 Skill 当前推荐 `.agents/skills`，按 metadata 渐进发现 | 目标 CLI 对现有 `.codex/skills` 实测稳定，当前不迁移 |
| Plugin | 通过 manifest、skills 和 marketplace 形成安装分发单元 | 单仓库不需要；跨仓库/团队分发时再评估 |
| Project config | 可信项目可加载 `.codex/config.toml`，支持 permissions 和 `skills.config` | M4-B 可用于 Worker 权限策略，但 M4-A 不创建配置 |
| Custom Agent | 需要名称、描述、developer instructions，可组合 model/sandbox/MCP/Skill | 可作为 12 角色映射载体，当前未启动 Agent |

资料 URL 和结论摘要保存在 `official-runtime-sources.json`。

## 4. Agent 到 Worker 映射

12 个角色均已形成映射建议。planning 角色禁止业务写入、发布和 Git；review/interface verification 角色禁止业务写入；backend/frontend 只允许 task-owned 对应源码；publisher/git-committer 在 M4 只返回报告，由 M2/M3 处理证据与状态。

详细逐角色边界位于 `agent-runtime-mapping.json`。本报告不声称 Worker、Subagent 或自动调度已经实现。

## 5. 实施中发现并修复的问题

中文 M4-A 任务 DAG 在 Windows PowerShell 5.1 下无法通过校验。根因是三个 DAG 消费脚本使用默认代码页读取 UTF-8 JSON；包含中文句号时会破坏相邻 JSON 引号。

本次按 TDD 增加 `task-dag.test.ps1`：先复现校验器失败，再逐个验证 Worktree 计划和接口用例派生失败，随后仅为三个 `Get-Content` 调用增加 `-Encoding UTF8`。回归测试同时断言中文标题和验收标准未被静默改写。

## 6. 延期边界

- 未验证 ChatGPT 桌面端或 IDE 的项目 Skill 发现；需要将其加入正式目标时再做对应新会话检查。
- 未验证 Linux/macOS；当前证据只覆盖 Windows CLI。
- CLI 升级可能改变兼容路径；升级后应重跑正向和负向检查。
- 未把兼容性探针固化为长期产品脚本；当前 CLI 自带调试入口足够，只有频繁升级导致重复人工成本时再自动化。

这些边界不影响当前目标 CLI 的基本可用性，不在 M4-A 追加兼容层。

## 7. 最终门禁与审核

最后一轮重新执行了 3 次仓库内 CLI 检查和 1 次仓库外负向对照，结果仍为 13/13/13 和 0。M2 状态运行时、M3 Dispatcher、Harness 状态契约、中文 UTF-8 DAG、结构、活动状态、M4-A DAG、完整 Smoke、知识新鲜度、文档一致性、JSON 解析和 no-build 检查全部通过。

`git diff --check` 没有空白错误，仅报告 Windows 工作区的 LF/CRLF 转换提示。最终审核没有发现影响稳定性、基本可用性或近期扩展的未解决 `BLOCKER/WARNING`。

在 Git 暂存把此前 untracked 的阶段产物纳入检查后，7 个已绑定状态 SHA-256 的历史证据文件因 EOF 空行触发 `git diff --cached --check` 提示。为保持完成态证据哈希有效，这些历史字节不再改写；排除 `.harness/runs/M4-A-001/**` 后的 staged 代码和当前文档没有空白错误。该格式提示不影响脚本执行、JSON 解析或兼容性结论。

详细证据位于 `.harness/runs/M4-A-001/phases/08-git-delivery/final-verification-report.md`。用户随后明确批准暂存本 Story owned 文件并创建本地提交，Harness 已完成 `git-delivery` 并进入 `done`；`git push`、PR、发布和部署仍未获批准。
