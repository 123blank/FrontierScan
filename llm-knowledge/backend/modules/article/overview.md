---
generated_by: frontier-kb-generate
layer: L1-baseline
area: backend
module: article
doc_type: overview
git_hash: 2bcaa65e73d02ab23d884f93e1640a7459fe1c46
source_fingerprint: sha256:02897b16ea75aacf078cb5559e731ab6e8d90f3a10e4121a11641f642ae653b4
generated_at: 2026-07-16T08:51:47.497Z
baseline_status: fresh
semantic_status: fresh
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
- 控制器数量：1
- 实体数量：2
- 数据仓库数量：2

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

需要 AI 审核：请结合 L2 语义增强确认该模块的业务边界、核心流程和跨模块依赖。
