---
generated_by: frontier-kb-generate
layer: L1-baseline
area: backend
module: article
doc_type: overview
git_hash: 4ab9c49f8ef459e1ab90bd143c1799fef2a46aa1
source_fingerprint: sha256:bbcf5341e6170bd7ed08d61a4a0c011601f2a3a4d843008f80dbda0d6a18662b
generated_at: 2026-07-11T17:38:46.678Z
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

# article 后端模块概览

## 自动识别职责

- 模块路径：`backend/src/main/java/com/frontierscan/article`
- Java 文件数：12
- 类/接口/记录/枚举数量：11
- Controller 数量：1
- Entity 数量：2
- Repository 数量：2

## 主要类

- class Article (backend/src/main/java/com/frontierscan/article/Article.java)
- class ArticleController (backend/src/main/java/com/frontierscan/article/ArticleController.java)
- interface ArticleRepository (backend/src/main/java/com/frontierscan/article/ArticleRepository.java)
- class ArticleService (backend/src/main/java/com/frontierscan/article/ArticleService.java)
- record ArticleSummaryRecoveryProperties (backend/src/main/java/com/frontierscan/article/ArticleSummaryRecoveryProperties.java)
- class ArticleSummaryRecoveryScheduler (backend/src/main/java/com/frontierscan/article/ArticleSummaryRecoveryScheduler.java)
- class ArticleSummaryService (backend/src/main/java/com/frontierscan/article/ArticleSummaryService.java)
- class ArticleSummaryStatus (backend/src/main/java/com/frontierscan/article/ArticleSummaryStatus.java)
- class Favorite (backend/src/main/java/com/frontierscan/article/Favorite.java)
- record FavoriteArticleView (backend/src/main/java/com/frontierscan/article/FavoriteArticleView.java)
- interface FavoriteRepository (backend/src/main/java/com/frontierscan/article/FavoriteRepository.java)

## 语义说明

Needs AI Review: 请结合 L2 语义增强确认该模块的业务边界、核心流程和跨模块依赖。
