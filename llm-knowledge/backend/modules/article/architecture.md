---
generated_by: frontier-kb-generate
layer: L1-baseline
area: backend
module: article
doc_type: architecture
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
