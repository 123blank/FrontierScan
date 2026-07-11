---
generated_by: frontier-kb-generate
layer: L1-baseline
area: backend
module: article
doc_type: architecture
git_hash: dfbb39a87e15c337796a7f2fb38cf48430fe769e
generated_at: 2026-07-06T09:39:30.103Z
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

# article 架构基线

## 模块内部结构

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

## 定时/异步执行

- ArticleSummaryRecoveryScheduler (backend/src/main/java/com/frontierscan/article/ArticleSummaryRecoveryScheduler.java)

## 待增强说明

Needs AI Review: 请补充核心调用链、事务边界、异步补偿流程和跨模块协作方式。
