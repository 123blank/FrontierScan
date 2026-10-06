# Article Read Status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 FrontierScan 增加持久化文章已读/未读状态，打开详情自动已读并支持重新标记未读。

**Architecture:** 使用 `articles.read_at` 表示状态，后端通过显式 REST 接口修改并复用用户归属校验。前端在详情加载后标记已读，并在看板、收藏列表和详情间同步状态。

**Tech Stack:** Java 17、Spring Boot 3、JPA、Flyway、Vue 3、TypeScript、Axios

---

### Task 1: 后端阅读状态

**Files:**
- Create: `backend/src/test/java/com/frontierscan/article/ArticleReadStatusIntegrationTest.java`
- Create: `backend/src/main/resources/db/migration/V11__add_article_read_status.sql`
- Modify: `backend/src/test/java/com/frontierscan/security/UserDataIsolationIntegrationTest.java`
- Modify: `backend/src/main/java/com/frontierscan/article/Article.java`
- Modify: `backend/src/main/java/com/frontierscan/article/ArticleService.java`
- Modify: `backend/src/main/java/com/frontierscan/article/ArticleController.java`
- Modify: `backend/src/main/java/com/frontierscan/article/FavoriteArticleView.java`
- Modify: `backend/src/main/java/com/frontierscan/article/FavoriteRepository.java`

- [ ] 编写失败测试：新文章 `readAt` 为空，标记已读后非空，标记未读后为空。
- [ ] 运行 `mvn -Dtest=ArticleReadStatusIntegrationTest test`，确认因接口缺失而失败。
- [ ] 编写跨用户修改失败测试并确认 RED。
- [ ] 增加 `V11` 迁移、实体字段、Service 事务方法和 Controller 接口。
- [ ] 更新收藏投影以携带 `readAt`。
- [ ] 重跑针对性测试并确认 GREEN。

### Task 2: 前端阅读状态

**Files:**
- Modify: `frontend/src/types.ts`
- Modify: `frontend/src/api/articles.ts`
- Modify: `frontend/src/views/DashboardView.vue`
- Modify: `frontend/src/views/FavoritesView.vue`

- [ ] 为文章类型增加 `readAt`。
- [ ] 增加 `markRead` 和 `markUnread` API。
- [ ] 看板卡片和收藏卡片显示已读/未读状态。
- [ ] 详情加载成功后调用 `markRead` 并同步列表。
- [ ] 详情增加“标记未读”按钮并同步列表。
- [ ] 运行 `npm run build`，修复所有类型和构建错误。

### Task 3: 闭环验证

**Files:**
- Create: `.harness/runs/M6-A-001/phases/03-implementation/implementation-notes.md`
- Create: `.harness/runs/M6-A-001/phases/04-unit-test/test-report.md`
- Create: `.harness/runs/M6-A-001/phases/05-code-review/code-review-report.md`
- Create: `.harness/runs/M6-A-001/phases/06-build-publish/build-report.md`
- Create: `.harness/runs/M6-A-001/phases/07-interface-verification/interface-verification-report.md`
- Create: `.harness/runs/M6-A-001/phases/08-git-delivery/delivery-report.md`

- [ ] 运行测试选择器和后端完整测试。
- [ ] 运行前端构建。
- [ ] 审核任务自有差异，修复 BLOCKER 后重跑门禁。
- [ ] 启动可用本地环境并验证 API/UI；不可用时记录具体原因。
- [ ] 生成交付摘要，停在 `git add/commit/push/PR` 批准前。
