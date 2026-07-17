# Harness M3 最终验证报告

## 验证身份

- 验证时间：`2026-07-17T13:38:15+08:00`
- 分支：`feat/harness-m3-agent-dispatcher`
- HEAD：`2b15e640d9f0f6e5be179dee838b3cb70784470e`
- 工作区：128 个已跟踪修改、43 个未跟踪文件、0 个已暂存文件。
- `backend/src/**`、`frontend/src/**`：无差异。

核心文件 SHA-256：

| 文件 | SHA-256 |
| --- | --- |
| `.harness/scripts/lib/story-runtime.mjs` | `f93d2ce6bb62017d2c2f367edc89fb7c018cc590188761081c206a218db88f46` |
| `.harness/scripts/tests/story-runtime.test.mjs` | `fea89b2989d2e664aa48da8b5236a861aa8b28e68ac738a3d7dc5a3f8810c7b5` |
| `.harness/scripts/lib/state-runtime.mjs` | `479dada631776b8d51332be40820c63f5db24debe4b94c0e41e107a8ba32d94f` |
| `.harness/scripts/tests/state-runtime.test.mjs` | `de0389bea4aa849d51e2d4efaa62499c0cd39da801e009447af254263ac5bbd4` |

## 命令与结果

| 命令 | 结果 | 关键输出 |
| --- | --- | --- |
| `node .harness/scripts/tests/story-runtime.test.mjs` | 通过 | `story-runtime tests passed`，包含 no-build 差异拒绝、推进后 checkpoint 对账和 evidence 篡改拒绝回归 |
| `node .harness/scripts/tests/state-runtime.test.mjs` | 通过 | `state-runtime tests passed` |
| `node .harness/scripts/tests/source-fingerprint.test.mjs` | 通过 | `source-fingerprint tests passed` |
| `node .harness/scripts/tests/harness-status.test.mjs` | 通过 | `harness status tests passed`，运行态 ignore 与 `.gitignore` owned 边界通过 |
| `node .harness/scripts/tests/generate-kb.test.mjs` | 通过 | `generate-kb tests passed` |
| `.harness/scripts/tests/kb-query.test.ps1` | 通过 | `kb-query tests passed` |
| `.harness/scripts/tests/kb-freshness.test.ps1` | 通过 | `kb-freshness tests passed` |
| `.harness/scripts/validate-structure.ps1` | 通过 | 19 个目录、117 个文件、13 个 Skill |
| `validate-state.ps1` 校验 `.harness/states/*.json` | 通过 | active-run、E2E 活动状态、E2E/Product 模板均通过 |
| `validate-task-dag.ps1 -TaskDagFile .harness/outputs/task-dag.json` | 通过 | 4 个任务、3 条边、4 个波次 |
| `.harness/scripts/smoke-harness-flow.ps1` | 通过 | M2/M3、结构、状态、知识、DAG 和只读辅助流程通过 |
| `.harness/scripts/check-kb-freshness.ps1` | 通过 | backend/frontend/common 均为 fresh |
| `git status --porcelain=v1 --untracked-files=all -- backend frontend` | 通过 | 输出为空，当前工作区符合 `no-build-required` 条件 |
| `git diff --check` | 通过 | 无空白错误，仅既存 Windows 行尾提示 |
| `git status --short -- backend/src frontend/src` | 通过 | 无业务源码差异 |

## 历史证据边界

`.harness/runs/M3-001/phases/04-unit-test/`、`05-code-review/` 和 `06-build-publish/` 保留 2026-07-16 当时阶段推进的历史证据，不改写其 SHA-256。它们早于 2026-07-17 完成的 adapter evidence 哈希与 no-build 差异门禁修复，因此不再作为最终工作区的唯一验证依据。

本报告与 `.harness/reports/code-review-report.md` 是当前 `git-delivery` 阶段覆盖最终未提交内容的测试和审核依据，并分别通过状态运行时记录 SHA-256。

## 结论

当前未提交的 Harness M3 实现、文档、no-build 差异门禁、推进后恢复和运行态交付隔离通过所列测试和结构校验。验证时尚未执行发布、部署、暂存、提交、推送、PR 或状态完成。
