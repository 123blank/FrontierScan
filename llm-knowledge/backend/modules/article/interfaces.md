---
generated_by: frontier-kb-generate
layer: L1-baseline
area: backend
module: article
doc_type: interfaces
git_hash: 4ab9d045a22ba2f5b92b19ec2f8c37ae327556a4
generated_at: 2026-07-11T10:45:43.312Z
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
