---
generated_by: frontier-kb-generate
layer: L1-baseline
area: backend
module: article
doc_type: interfaces
git_hash: 50253a205e583bc24faab6c8f50cdcf352ddae23
source_fingerprint: sha256:bbcf5341e6170bd7ed08d61a4a0c011601f2a3a4d843008f80dbda0d6a18662b
generated_at: 2026-07-15T03:45:44.398Z
baseline_status: fresh
semantic_status: pending
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

# article 接口与集成点

## Controllers

- ArticleController：/api/articles (backend/src/main/java/com/frontierscan/article/ArticleController.java)

## HTTP Endpoints

- GET /api/articles -> ArticleController (backend/src/main/java/com/frontierscan/article/ArticleController.java)
- GET /api/articles/{id} -> ArticleController (backend/src/main/java/com/frontierscan/article/ArticleController.java)
- POST /api/articles/{id}/summary/retry -> ArticleController (backend/src/main/java/com/frontierscan/article/ArticleController.java)
- GET /api/articles/favorites -> ArticleController (backend/src/main/java/com/frontierscan/article/ArticleController.java)
- POST /api/articles/{id}/favorite -> ArticleController (backend/src/main/java/com/frontierscan/article/ArticleController.java)
- DELETE /api/articles/{id}/favorite -> ArticleController (backend/src/main/java/com/frontierscan/article/ArticleController.java)
- GET /api/articles/count -> ArticleController (backend/src/main/java/com/frontierscan/article/ArticleController.java)

## 外部调用/集成提示

Needs AI Review: 自动基线只识别 Spring MVC 注解，复杂参数、权限、响应体和异常语义需由 L2 或人工补充。
