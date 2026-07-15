---
generated_by: frontier-kb-generate
layer: L1-baseline
area: backend
module: article
doc_type: config
git_hash: 8f741538f612f9293972aaff3a81e8c3812b8236
source_fingerprint: sha256:02897b16ea75aacf078cb5559e731ab6e8d90f3a10e4121a11641f642ae653b4
generated_at: 2026-07-15T15:48:15.724Z
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

# article 配置基线

## 配置属性

- app.summary-recovery -> ArticleSummaryRecoveryProperties (backend/src/main/java/com/frontierscan/article/ArticleSummaryRecoveryProperties.java)

## 异步与调度配置线索

- ArticleSummaryRecoveryScheduler (backend/src/main/java/com/frontierscan/article/ArticleSummaryRecoveryScheduler.java)

## 待增强说明

需要 AI 审核：请补充环境变量、默认值、生产风险和降级行为。
