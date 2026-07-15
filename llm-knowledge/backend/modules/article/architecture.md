---
generated_by: frontier-kb-generate
layer: L1-baseline
area: backend
module: article
doc_type: architecture
git_hash: cb5edb5cde7a1635447198f2e2bedc8c3ee225e9
source_fingerprint: sha256:bbcf5341e6170bd7ed08d61a4a0c011601f2a3a4d843008f80dbda0d6a18662b
generated_at: 2026-07-15T15:00:02.197Z
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

## 定时与异步执行

- ArticleSummaryRecoveryScheduler (backend/src/main/java/com/frontierscan/article/ArticleSummaryRecoveryScheduler.java)

## 待增强说明

需要 AI 审核：请补充核心调用链、事务边界、异步补偿流程和跨模块协作方式。
