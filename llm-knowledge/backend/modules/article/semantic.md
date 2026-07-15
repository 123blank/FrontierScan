---
generated_by: openai-compatible
layer: L2-semantic
area: backend
module: article
doc_type: semantic
git_hash: cb5edb5cde7a1635447198f2e2bedc8c3ee225e9
source_fingerprint: sha256:bbcf5341e6170bd7ed08d61a4a0c011601f2a3a4d843008f80dbda0d6a18662b
generated_at: 2026-07-15T13:48:58.533Z
baseline_status: fresh
semantic_status: fresh
semantic_provider: coding.xiaofeilun.cn
source_files:
  - backend/src/main/java/com/frontierscan/article/Article.java
  - backend/src/main/java/com/frontierscan/article/ArticleController.java
  - backend/src/main/java/com/frontierscan/article/ArticleRepository.java
  - backend/src/main/java/com/frontierscan/article/ArticleService.java
  - backend/src/main/java/com/frontierscan/article/ArticleSummaryRecoveryProperties.java
  - backend/src/main/java/com/frontierscan/article/ArticleSummaryRecoveryScheduler.java
  - backend/src/main/java/com/frontierscan/article/ArticleSummaryService.java
  - backend/src/main/java/com/frontierscan/article/ArticleSummaryStatus.java
  - backend/src/main/java/com/frontierscan/article/Favorite.java
  - backend/src/main/java/com/frontierscan/article/FavoriteArticleView.java
  - backend/src/main/java/com/frontierscan/article/FavoriteRepository.java
  - backend/src/main/java/com/frontierscan/article/package-info.java
---

# article 语义增强

semantic_status: fresh
semantic_model: gpt-5.5
semantic_provider: coding.xiaofeilun.cn

## 模块职责

article 后端模块负责文章领域的核心 API、持久化实体、仓储访问、收藏能力、文章批量入库、文章摘要治理与摘要失败恢复调度。它以 ArticleController 对外提供 /api/articles 下的查询、详情、摘要重试、收藏和计数接口；以 ArticleService 处理文章保存、收藏变更和摘要更新等事务性业务；以 ArticleSummaryService 和 ArticleSummaryRecoveryScheduler 对接 LLM 摘要生成、质量评估和恢复配置；以 Article 与 Favorite 映射 articles、favorites 数据表。

## 核心业务流程

- 文章查询流：ArticleController 暴露 /api/articles 的 GET list 接口，接收 JwtPrincipal 以及 categoryId、siteId、keyword、tagId、startDate、endDate、page、size 等可选查询参数，返回 ApiResponse<Page<Article>>。
- 文章详情流：ArticleController 暴露 /api/articles/{id} 的 GET get 接口，基于路径参数 id 和认证主体 JwtPrincipal 返回 ApiResponse<Article>。
- 摘要重试流：ArticleController 暴露 /api/articles/{id}/summary/retry 的 POST retrySummary 接口，基于文章 id 和 JwtPrincipal 返回 ApiResponse<Article>，用于触发或请求文章摘要重试。
- 收藏列表流：ArticleController 暴露 /api/articles/favorites 的 GET favorites 接口，接收 JwtPrincipal 以及 keyword、tagId、startDate、endDate 等过滤参数，返回 ApiResponse<List<FavoriteArticleView>>。
- 收藏变更流：ArticleController 暴露 /api/articles/{id}/favorite 的 POST toggleFavorite 和 DELETE removeFavorite 接口，分别用于切换收藏和移除收藏，返回 ApiResponse<Map<String, Object>>。
- 文章计数流：ArticleController 暴露 /api/articles/count 的 GET count 接口，基于 JwtPrincipal 返回 ApiResponse<Map<String, Object>>。
- 采集入库流：ArticleService 的 batchSaveArticles(userId, siteId, categoryId, rawArticles) 是事务方法，接收 CollectResult.RawArticle 列表并返回实际新增保存的 Article 列表。
- 摘要治理流：ArticleSummaryService 提供 applySummaryResult(article, result) 和 markFailed(article, reason) 事务方法，结合 SummaryResult 对 Article 摘要状态进行落库或失败标记。
- 摘要恢复流：ArticleSummaryRecoveryScheduler 是定时任务组件，依赖 ArticleRepository、ArticleSummaryService、ArticleService 和 ArticleSummaryRecoveryProperties；恢复配置由 prefix 为 app.summary-recovery 的 ArticleSummaryRecoveryProperties 承载。

## 跨模块依赖

- common.api：ArticleController 使用 ApiResponse 作为统一响应包装。
- common.security：ArticleController 接收 JwtPrincipal 作为认证主体参数。
- common.error：模块导入 ResourceNotFoundException，表明文章或收藏相关业务可能通过通用异常表达资源不存在。
- collection：ArticleService 的 batchSaveArticles 接收 CollectResult.RawArticle，说明文章入库依赖采集模块输出。
- llm：ArticleService 与 ArticleSummaryService 依赖 LlmProperties、SummaryMapReduceService、SummaryQualityEvaluator、SummaryResult 等摘要生成与质量评估能力。
- llm.tag：ArticleService 依赖 TagEvaluationAgent 和 ArticleTagMappingMapper，说明文章与标签评估/映射子模块存在耦合。
- Spring Data JPA：ArticleRepository 和 FavoriteRepository 基于 JpaRepository，并使用 Query、Param、Page、PageRequest、Pageable 等数据访问与分页能力。
- Spring Scheduling：ArticleSummaryRecoveryScheduler 使用 Scheduled，承担定时恢复任务。
- Spring Configuration Properties：ArticleSummaryRecoveryProperties 使用 ConfigurationProperties，配置前缀为 app.summary-recovery。
- 数据库迁移资源：文章模块相关结构与治理字段涉及 V1__initial_schema.sql、V3__add_schema_comments.sql、V4__create_tag_system.sql、V7__add_article_summary_governance.sql、V8__backfill_article_summary_status.sql、V9__add_article_full_content.sql、V10__make_article_source_hash_global_unique.sql。

## 风险点

- 摘要相关逻辑横跨 ArticleService、ArticleSummaryService、ArticleSummaryRecoveryScheduler 和多个 LLM 组件，变更时需要关注事务边界、失败标记、重试入口和定时恢复是否一致。
- batchSaveArticles 存在重复的 facts 记录，其中一条 return_type 被注释文本污染；消费该事实时应以明确的 List<Article> 记录为准，并避免把污染内容当作真实方法签名。
- ArticleController 的 endpoints facts 中 security 数组为空，但接口参数包含 @AuthenticationPrincipal JwtPrincipal；权限语义需要以安全配置和控制器实现为准，不能仅凭 endpoints.security 推断为公开接口。
- 收藏切换和删除是事务方法并依赖 FavoriteRepository；并发请求同一 userId/articleId 时需关注重复收藏、删除幂等性和数据库约束。
- 文章摘要恢复由配置 app.summary-recovery 和定时任务驱动；配置错误或调度频率不当可能导致重试不足或重复处理。
- 模块依赖数据库迁移中的文章摘要治理、全文内容、source_hash 全局唯一等变更；实体字段、仓储查询和迁移脚本需要保持一致。

## 动态消费提示

- 该模块的主要 REST 入口集中在 ArticleController，统一基础路径为 /api/articles，返回值统一包装为 ApiResponse。
- 调用文章列表接口时 page 默认值为 0，size 默认值为 20；categoryId、siteId、keyword、tagId、startDate、endDate 均为可选 RequestParam。
- 收藏相关能力同时包含查询、切换和删除三个端点；收藏列表返回 FavoriteArticleView，而收藏变更返回 Map<String, Object> 包装结果。
- Article 与 Favorite 是 JPA 实体，分别映射 articles 与 favorites 表；持久化访问由 ArticleRepository 和 FavoriteRepository 承担。
- 摘要恢复功能受 app.summary-recovery 配置属性影响，并存在 ArticleSummaryRecoveryScheduler 定时任务入口。
- 事务边界主要分布在 ArticleService 和 ArticleSummaryService：批量保存文章、收藏变更、摘要更新、摘要结果应用和失败标记都属于事务敏感操作。
- 模块依赖 LLM 相关能力，包括 LlmProperties、SummaryMapReduceService、SummaryQualityEvaluator、SummaryResult、SummaryQualityResult、SummaryRequest 以及 SummaryMapReduceException。
- 模块还依赖标签评估与映射能力，包括 TagEvaluationAgent 和 ArticleTagMappingMapper，说明文章处理流程会与标签系统发生交互。

## 来源文件

- backend/src/main/java/com/frontierscan/article/Article.java
- backend/src/main/java/com/frontierscan/article/ArticleController.java
- backend/src/main/java/com/frontierscan/article/ArticleRepository.java
- backend/src/main/java/com/frontierscan/article/ArticleService.java
- backend/src/main/java/com/frontierscan/article/ArticleSummaryRecoveryProperties.java
- backend/src/main/java/com/frontierscan/article/ArticleSummaryRecoveryScheduler.java
- backend/src/main/java/com/frontierscan/article/ArticleSummaryService.java
- backend/src/main/java/com/frontierscan/article/ArticleSummaryStatus.java
- backend/src/main/java/com/frontierscan/article/Favorite.java
- backend/src/main/java/com/frontierscan/article/FavoriteArticleView.java
- backend/src/main/java/com/frontierscan/article/FavoriteRepository.java
- backend/src/main/java/com/frontierscan/article/package-info.java
