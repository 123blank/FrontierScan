# M7-D-001 交付准备报告

## 结论

真实 Story“Dashboard 文章已读/未读状态筛选”已完成业务开发、测试、审核、构建和真实 API/UI 验收，当前具备交付准备条件。`done` 仅表示业务闭环和交付准备完成，本阶段未执行 `git add`、`git commit`、`git push`、发布或部署。

## Story Owned 文件

Runtime 基于初始化基线、`implementation.actualFiles`、当前 Git 净变化和 DAG prediction 推导出 9 个 owned 文件：

- `backend/src/main/java/com/frontierscan/article/ArticleController.java`
- `backend/src/main/java/com/frontierscan/article/ArticleRepository.java`
- `backend/src/main/java/com/frontierscan/article/ArticleService.java`
- `backend/src/test/java/com/frontierscan/article/ArticleReadStatusApiIntegrationTest.java`
- `backend/src/test/java/com/frontierscan/article/ArticleServiceFilterTest.java`
- `frontend/src/api/articles.ts`
- `frontend/src/utils/readStatusFilter.ts`
- `frontend/src/views/DashboardView.vue`
- `frontend/tests/readStatusFilter.test.ts`

受控 manifest：`.harness/runs/M7-D-001/delivery/owned-manifest.json`。

## 预测外修改

以下 2 个文件是在真实 UI 验收发现列表往返刷新问题后，经批准的 late-stage rework 新增，因此不在原 DAG `predictedFiles` 中，但已正式回投 `implementation.actualFiles`：

- `frontend/src/utils/readStatusFilter.ts`
- `frontend/tests/readStatusFilter.test.ts`

该差异已被显式记录，不构成未解决风险。

## 验证摘要

| 门禁 | 结果 | 证据 |
| --- | --- | --- |
| 单元与集成测试 | 通过 | 后端 163 个测试；前端 helper 2 个测试；Harness State/Story 回归通过 |
| 独立代码审核 | 通过 | 两项 BLOCKER 和一项 WARNING 已关闭；最终复审无未解决问题 |
| 构建 | 通过 | `mvn package` 与 `npm run build` 成功 |
| API 验收 | 通过 | all=217、unread=216、read=1、组合筛选=1、非法参数 HTTP 400 |
| Chrome UI 验收 | 通过 | 状态筛选、分页重置、组合条件、自动已读和恢复未读往返均通过 |
| 验收标准 | 通过 | 五项 required acceptance criterion 均为 `verified` |

## Unrelated Dirty 文件

Runtime 将业务 Story 之外的 Harness Runtime、M7-D 验收脚本、计划文档和 `llm-knowledge` 刷新结果保留为 `unrelatedDirtyFiles`。这些文件属于当前 M7-D 架构迭代工作，但不应被业务 Story 的 owned manifest 认领；最终提交准备时必须按实际提交目标重新划分和审核。

## 剩余风险

无未解决业务风险。已知的预测外修改已通过 TDD、构建、真实 Chrome 验收和独立复审关闭。

## Git 状态

`gitStatus=not-requested`。未执行任何 Git 写操作；后续如需暂存、提交或推送，仍需用户明确批准。
