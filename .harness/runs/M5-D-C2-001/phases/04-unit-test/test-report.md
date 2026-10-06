# M5-D-C2 测试报告

## 结果

| 命令 | 结果 | 证据 |
| --- | --- | --- |
| `node .\.harness\scripts\tests\worktree-worker-runtime.test.mjs` | PASS | 72/72；覆盖 C1、freeze、integration、partial recovery、finalize 和 M3 apply |
| `node .\.harness\scripts\tests\story-runtime.test.mjs` | PASS | ordinary、serial batch、Wave finalization 与历史 revision 回归通过 |
| `node .\.harness\scripts\tests\worktree-wave-runtime.test.mjs` | PASS | 34/34 |
| `node .\.harness\scripts\tests\worktree-runtime.test.mjs` | PASS | 28/28 |
| `node .\.harness\scripts\tests\worker-runtime.test.mjs` | PASS | Worker Runtime 回归通过 |
| `node .\.harness\scripts\tests\worktree-wave-execution-runtime.test.mjs` | PASS | 9/9 |
| `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.harness\scripts\validate-structure.ps1` | PASS | 30 个目录、209 个必需文件、13 个 Skill 文件 |
| `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.harness\scripts\smoke-harness-flow.ps1` | PASS | 状态、DAG、知识、规划、构建与交付摘要 Smoke 通过 |
| `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.harness\scripts\check-kb-freshness.ps1` | PASS | backend/frontend/common 均 fresh |
| `git diff --check` | PASS | 无 whitespace error |

## 说明

- RED：Windows 下并发 recovery writer 两次完整运行稳定复现 `EPERM`，不符合 owner-fencing 错误契约。
- GREEN：最小错误归一化后，目标用例、Wave Runtime 34/34、Worktree Runtime 28/28 和依赖回归全部通过。
- Harness-only 变更，无 backend/frontend 构建需求。
- `CODEX-CROSS-SESSION-HANDOFF.md` 为无关未跟踪文件，未修改、未暂存。
