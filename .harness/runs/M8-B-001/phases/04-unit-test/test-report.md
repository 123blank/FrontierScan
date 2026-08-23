# M8-B 测试报告

## 结论

M8-B Development Provider 专项、纵向 E2E、M5-B2 Integration、M8-A 只读 Provider、Story/E2E Runtime、结构校验、冒烟流程和差异检查均通过。

本报告证明真实开发 Provider 所需协议、隔离边界、候选对账、固定测试、恢复和受控集成具备可执行实现。真实 Codex CLI 开发 fixture 与真实 backend Story 仍属于后续验收，不在本报告中声明为已完成。

## 执行结果

| 范围 | 命令 | 结果 |
| --- | --- | --- |
| Development Runtime | `node .\.harness\scripts\tests\development-provider-runtime.test.mjs` | passed |
| Development 纵向 E2E | `node .\.harness\scripts\tests\development-provider-e2e.test.mjs` | passed，3/3 |
| Worktree Integration | `node .\.harness\scripts\tests\worktree-integration-runtime.test.mjs` | passed，47/47 |
| E2E Runtime | `node .\.harness\scripts\tests\e2e-runtime.test.mjs` | passed |
| M8-A Codex CLI | `node .\.harness\scripts\tests\codex-cli-provider.test.mjs` | passed |
| M8-A Provider Runtime | `node .\.harness\scripts\tests\provider-runtime.test.mjs` | passed |
| Story Runtime | `node .\.harness\scripts\tests\story-runtime.test.mjs` | passed |
| 结构校验 | `.\.harness\scripts\validate-structure.ps1` | passed，41 个目录、319 个文件、13 个 Skill |
| 冒烟流程 | `.\.harness\scripts\smoke-harness-flow.ps1` | passed |
| 差异检查 | `git diff --check` | passed |

## 验收项覆盖

| 用例 | 覆盖验收项 | 结果 | 证据摘要 |
| --- | --- | --- | --- |
| TC-M8B-DEVELOPMENT-CHAIN | AC-M8B-REAL-DEVELOPER、AC-M8B-CONTROLLED-INTEGRATION | passed | backend/frontend fixture 均完成 Prepare 到 Story Apply 的受控链路 |
| TC-M8B-WORKTREE-GATE | AC-M8B-WORKTREE-ONLY、AC-M8B-PREDICTED-FILE-GATE | passed | 越权文件使整个 attempt 失败，主树保持不变 |
| TC-M8B-TRUSTED-TEST | AC-M8B-CANDIDATE-TEST | passed | 固定测试使用受限 sandbox、可信工具链和候选漂移复验 |
| TC-M8B-RECOVERY | AC-M8B-RECOVERY | passed | claim-first、Materialize、Test、Finalize 和 Integration 中断恢复通过 |
| TC-M8B-MODEL-ROUTING | AC-M8B-MODEL-ROUTING | passed | backend/frontend Profile 与模型切换不改变 sandbox、cwd 和角色权限 |
| TC-M8B-REAL-STORY-PROTOCOL | AC-M8B-REAL-STORY | passed | 真实 Story 所需入口、receipt、集成和 Story Apply 协议已由 fixture 覆盖；真实业务验收待后续执行 |

## 剩余验证

- 启动正式 M8-A `code-reviewer` Provider 审核当前 task-owned diff。
- 执行真实 Codex CLI Development Provider fixture。
- 使用一个真实 backend 单任务 Story 完成九阶段闭环。
- 完成文档与知识收口后执行最终闭包校验。
