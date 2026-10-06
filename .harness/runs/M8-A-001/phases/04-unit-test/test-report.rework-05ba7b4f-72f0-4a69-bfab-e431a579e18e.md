# M8-A-001 返工测试报告

## 范围

本轮在交付归属 rework 后重新验证 Provider 配置、契约、上下文、Codex CLI Adapter、
Provider Runtime、E2E/Story/State Runtime、知识、验收门禁、Worker 兼容和 Harness 结构。

## 结果

| 测试组 | 结果 |
| --- | --- |
| `provider-config.test.mjs` | passed |
| `provider-contract.test.mjs` | passed |
| `provider-context.test.mjs` | passed |
| `codex-cli-provider.test.mjs` | passed |
| `provider-runtime.test.mjs` | passed |
| `provider-cli.test.ps1` | passed |
| `e2e-runtime.test.mjs` | passed |
| `story-runtime.test.mjs` | passed |
| `state-runtime.test.mjs` | passed |
| `acceptance-gate.test.mjs` | passed |
| `knowledge-runtime.test.mjs` | passed |
| `worker-runtime.test.mjs` | passed |
| `worktree-wave-execution-runtime.test.mjs` | 9/9 passed |
| `validate-structure.ps1` | passed，40 个目录、297 个必需文件、13 个 Skill |
| `smoke-harness-flow.ps1` | passed |
| `git diff --check` | passed |

## 覆盖结论

- `AC-M8A-REAL-REVIEWER`：固定 CLI、Provider Runtime 和 E2E 动作映射通过。
- `AC-M8A-MODEL-ROUTING`：Profile、模型来源、自定义 Provider 元数据和注入拒绝通过。
- `AC-M8A-ZERO-CONTAMINATION`：完整性、脱敏、非法输出和 State 零污染通过。
- `AC-M8A-RESULT-LAST`：锁、超时、Materialize、幂等和中断恢复通过。
- `AC-M8A-COMPARISON-CLOSURE`：返工后完整阶段链、结构和交付前置条件通过。

## 说明

本轮未修改 backend/frontend，故不运行 Maven 或前端生产构建。构建阶段将继续使用
`no-build-required` 确定性 Adapter。
