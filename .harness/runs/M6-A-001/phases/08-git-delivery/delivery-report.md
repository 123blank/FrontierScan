# M6-A-001 交付说明

## 本任务修改

- 后端文章实体新增可空 `readAt`，通过 Flyway `V11` 增加 `articles.read_at`。
- 新增文章标记已读和标记未读 API，并复用现有用户归属校验。
- 收藏文章投影补充 `readAt`。
- 看板和收藏页显示已读/未读状态；打开详情自动标记已读，并支持重新标记未读、失败反馈与重试。
- 增加 Service、持久化、用户隔离及 MockMvc + JWT Security Filter 集成测试。
- 生成本 Story 的需求、设计、任务 DAG、实现、测试、审核、构建、接口验证和交付阶段记录。

## 任务自有文件

- `.harness/runs/M6-A-001/phases/00-requirement/requirement-breakdown.md`
- `.harness/runs/M6-A-001/phases/01-technical-design/technical-design.md`
- `.harness/runs/M6-A-001/phases/02-task-dag/task-dag.json`
- `.harness/runs/M6-A-001/phases/03-implementation/implementation-notes.md`
- `.harness/runs/M6-A-001/phases/04-unit-test/test-report.md`
- `.harness/runs/M6-A-001/phases/05-code-review/code-review-report.md`
- `.harness/runs/M6-A-001/phases/06-build-publish/build-report.md`
- `.harness/runs/M6-A-001/phases/07-interface-verification/interface-verification-report.md`
- `.harness/runs/M6-A-001/phases/08-git-delivery/delivery-report.md`
- `backend/src/main/java/com/frontierscan/article/Article.java`
- `backend/src/main/java/com/frontierscan/article/ArticleController.java`
- `backend/src/main/java/com/frontierscan/article/ArticleService.java`
- `backend/src/main/java/com/frontierscan/article/FavoriteArticleView.java`
- `backend/src/main/java/com/frontierscan/article/FavoriteRepository.java`
- `backend/src/main/resources/db/migration/V11__add_article_read_status.sql`
- `backend/src/test/java/com/frontierscan/article/ArticleReadStatusApiIntegrationTest.java`
- `backend/src/test/java/com/frontierscan/article/ArticleReadStatusTest.java`
- `backend/src/test/java/com/frontierscan/article/ArticleServiceFilterTest.java`
- `backend/src/test/java/com/frontierscan/security/UserDataIsolationIntegrationTest.java`
- `frontend/src/api/articles.ts`
- `frontend/src/types.ts`
- `frontend/src/views/DashboardView.vue`
- `frontend/src/views/FavoritesView.vue`
- `docs/superpowers/plans/2026-08-11-article-read-status.md`
- `docs/superpowers/specs/2026-08-11-article-read-status-design.md`

`summarize-delivery.ps1` 仅按默认 Harness 路径识别任务归属，因此将业务代码和设计文档列入了“Unrelated Dirty Files”。经 Story 范围和工作区基线核对，上述文件均属于本任务；当前未发现无关工作区修改。

## 质量门禁

- 交付前复验（2026-08-11）：`mvn test`、`npm run build`、Harness 结构/状态/DAG 校验均成功。
- TDD RED：新增测试在实现前因缺少字段和方法按预期失败。
- 定向后端测试：20/20 通过。
- 完整后端测试：157/157 通过，0 失败，0 错误，0 跳过。
- 前端构建：`vue-tsc --noEmit` 与 Vite build 通过。
- 构建产物：后端 JAR 和前端 `dist` 生成成功，未发布。
- 代码审核：三轮独立审核完成，最终无 BLOCKER/WARNING。
- 接口验证：已读/未读 API、未认证拒绝、跨用户 404、幂等状态、收藏投影通过。
- Harness：结构、状态和任务 DAG 校验通过。

## 剩余风险

- 当前无可用运行环境，未执行桌面和移动端浏览器点击验证；该用例在接口验证报告中记录为 `blocked`。
- 未在真实 PostgreSQL 上执行 `V11`；测试环境使用 H2 验证实体和持久化契约。
- 本次后端和前端源码变更使 `llm-knowledge` 新鲜度显示为 `stale-or-incomplete`，实现决策已由目标源码、测试和审核直接核验，尚未刷新知识库。

## Git 边界

- 建议提交信息：`feat(article): add read and unread status`
- 目标分支：`dev`。
- 目标远程：`origin/dev`。
- 2026-08-11，用户回复“确认批准”，明确批准暂存本任务自有文件、提交并推送。
- 不创建 PR/MR，不发布或部署，不改写历史，不执行 force push。
