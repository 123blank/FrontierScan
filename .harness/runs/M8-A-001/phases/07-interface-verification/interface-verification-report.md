# M8-A-001 接口与闭环验收报告

## 验收环境

- 模式：本地 Harness 手工结构化验收
- 环境状态：`available`
- 可用组件：State/Story/E2E Runtime、Git 工作区、本机 Codex CLI Provider
- 不适用项：本 Story 不修改业务 API 或 UI，因此不执行浏览器或 HTTP 业务验证

## 验收结果

| 用例 | 验收标准 | 动作 | 实际结果 | 结论 |
| --- | --- | --- | --- | --- |
| `VC-M8A-REAL-REVIEWER` | `AC-M8A-REAL-REVIEWER` | 核对最终真实 execution receipt 和正式 code-review result | `codex exec` 真实完成，`exitCode=0`，结果由 Runtime 生成并应用 | `verified` |
| `VC-M8A-MODEL-ROUTING` | `AC-M8A-MODEL-ROUTING` | 核对冻结 request、receipt 和配置专项测试 | role、profile、adapter、model 与 modelSource 一致，模型配置未扩大权限 | `verified` |
| `VC-M8A-ZERO-CONTAMINATION` | `AC-M8A-ZERO-CONTAMINATION` | 核对仓库与隔离根完整性、正式输出归属 | 两项完整性检查均通过，Agent 未写业务文件、State 或 Git | `verified` |
| `VC-M8A-RESULT-LAST` | `AC-M8A-RESULT-LAST` | 核对 blocked/resume 历史、Materialize 恢复与 Apply | 多轮失败均失败关闭，最终 attempt 可从磁盘恢复并幂等应用 | `verified` |
| `VC-M8A-COMPARISON-CLOSURE` | `AC-M8A-COMPARISON-CLOSURE` | 对比人工审核、Provider 审核与修复记录 | 最终两类审核均无未解决 BLOCKER/WARNING，真实 Provider 发现的问题均已关闭 | `verified` |

## 证据说明

聚合证据位于当前 attempt 的 `evidence/m8a-acceptance-evidence.json`，其中绑定：

- 最终 Provider request、execution receipt 和 code-review result。
- 人工审核与 Runtime 生成的 Provider 审核报告。
- Provider 专项、恢复、完整性和回归测试报告。

所有五项 required criterion 均得到 `verified` 结论，没有使用
`accepted-with-known-gaps`，也没有伪造 UI 或 API 验证。

## 结论

M8-A 真实只读 `code-reviewer` Provider 的接口和闭环验收通过，可以进入
`delivery-preparation`。
