# M8-A-001 接口与闭环验收报告

## 验收环境

- 模式：本地 Harness 结构化验收
- 环境状态：`available`
- 可用组件：State/Story/E2E Runtime、Git 工作区、本机 Codex CLI Provider
- 不适用项：本 Story 不修改业务 API 或 UI，因此不执行浏览器或 HTTP 业务验证

## 验收结果

| 用例 | 验收标准 | 实际结果 | 结论 |
| --- | --- | --- | --- |
| `VC-M8A-REAL-REVIEWER` | `AC-M8A-REAL-REVIEWER` | 最新 `codex exec` 真实完成，`exitCode=0`，正式 result 已应用 | `verified` |
| `VC-M8A-MODEL-ROUTING` | `AC-M8A-MODEL-ROUTING` | role、profile、adapter、model 与 modelSource 可审计，模型配置未扩大权限 | `verified` |
| `VC-M8A-ZERO-CONTAMINATION` | `AC-M8A-ZERO-CONTAMINATION` | repository 与 isolated-root 完整性均通过，Agent 未写 State、Git 或正式结果 | `verified` |
| `VC-M8A-RESULT-LAST` | `AC-M8A-RESULT-LAST` | claim-only、Materialize、身份漂移和输出超限恢复均有 fixture，最终 result-last 链通过 | `verified` |
| `VC-M8A-COMPARISON-CLOSURE` | `AC-M8A-COMPARISON-CLOSURE` | 人工与最终真实 Provider 审核均无未解决 BLOCKER/WARNING | `verified` |

## 证据说明

当前 attempt 的 `evidence/m8a-acceptance-evidence.json` 绑定：

- 最新 Provider request、execution receipt、code-review result 和 Runtime 报告。
- 人工审核报告。
- 最终回归汇总。
- 真实 Provider 多轮发现问题及 TDD 修复记录。

所有五项 required criterion 均得到 `verified` 结论，没有使用
`accepted-with-known-gaps`，也没有伪造 UI 或 API 验证。

## 结论

M8-A 真实只读 `code-reviewer` Provider 的接口和闭环验收通过，可以进入
`delivery-preparation`。
