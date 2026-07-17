# Harness M3 交付摘要

## 分支与工作区

- 当前分支：`feat/harness-m3-agent-dispatcher`
- 已跟踪修改：128 个文件
- 未跟踪文件：43 个文件
- 已暂存：0
- `backend/src/**`、`frontend/src/**` 差异：0
- 无关脏文件：未发现

## Owned Changes

| 范围 | 主要内容 |
| --- | --- |
| M3 核心 | `story-runtime.mjs`、`run-story.ps1`、task/result Schema、run 专属 workflow 产物 |
| M2 兼容 | `{runId}` 展开、run 专属 DAG 路径、UTF-8 与 `active-run` 状态校验、PowerShell 默认根目录 |
| 门禁与恢复 | 固定 adapter、16 MiB 有界输出、Windows Maven/npm argv、adapter evidence SHA-256、no-build Git 差异检查、推进后 checkpoint 对账 |
| 测试 | M3 九阶段纵向测试、no-build 脏/净路径、推进后中断、evidence 篡改、活动指针、2 MiB 输出、BLOCKER、路径边界和结构契约 |
| Harness 集成 | 19/117/13 结构清单、Smoke、脚本 README、运行态 Git 隔离和 run 证据 |
| 文档 | M3 DESIGN/PLAN/REPORT、AI handover、架构状态与结构 checklist |
| 知识 | 按 Common 变更策略刷新 14 模块、125 个知识文件和 328 Chunk 索引 |

## Validation Summary

| 门禁 | 结果 | 证据 |
| --- | --- | --- |
| M3/M2 测试 | 通过 | `08-git-delivery/final-verification-report.md`，绑定当前核心文件 SHA-256 |
| 既有 Harness/知识回归 | 通过 | `08-git-delivery/final-verification-report.md` 中的 source fingerprint、status、generate/query/freshness 最新结果 |
| 结构/状态/DAG | 通过 | `08-git-delivery/final-verification-report.md`；19 个目录、117 个文件、13 个 Skill，活动状态与 4 节点 DAG 有效 |
| 审核 | 通过 | `.harness/reports/code-review-report.md`，当前 `git-delivery` 状态记录其 SHA-256 |
| Build | 通过 | 最终验证中 backend/frontend Git 差异为空；`06-build-publish` 仅保留历史决策，未发布 |
| Verification | 通过 | `07-interface-verification/interface-verification-report.md` |
| Knowledge | 通过 | backend/frontend/common fresh，Semantic pending，Embedding skipped |
| Diff | 通过 | `08-git-delivery/final-verification-report.md`；`git diff --check` 无空白错误，业务源码差异为空 |

## 证据时间边界

phase 4/5/6 报告保留 2026-07-16 当时阶段推进的历史事实。adapter evidence 哈希、no-build 差异门禁、推进后恢复和运行态交付隔离于 2026-07-17 完成，最终未提交内容以 `08-git-delivery/final-verification-report.md` 和 `.harness/reports/code-review-report.md` 为准；两者在当前 `git-delivery` 阶段重新绑定状态 SHA-256。

## Commit / PR Plan

建议提交信息：

```text
feat(harness): implement M3 single-story dispatcher
```

用户已于 2026-07-17 明确批准：提交当前 M3 业务分支，并将其合并到本地 `dev` 分支。授权不包含 `git push`、创建 PR、发布、部署或删除业务分支。

更新本报告时尚未执行 `git add`、`git commit`、分支合并、`git push` 或创建 PR。后续只执行上述已批准范围内的本地 Git 操作。

## 结论

M3 业务实现、测试、审核、构建决策和接口验证已完成，用户已批准状态完成、本地提交和合并至本地 `dev`。推送及其他外部交付操作仍未获批准。
