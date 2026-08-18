---
generated_by: frontier-kb-generate
layer: L1-baseline
area: backend
module: article
doc_type: config
git_hash: f12d893896617845242abb75e23d577fc730d579
source_fingerprint: sha256:1be9274e55442429c8a5da213e792fd54df8500799df185c03b9f2242fc6efe6
generated_at: 2026-08-18T08:26:55.918Z
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

# article 配置基线

## 配置属性

- app.summary-recovery -> ArticleSummaryRecoveryProperties (backend/src/main/java/com/frontierscan/article/ArticleSummaryRecoveryProperties.java)

## 异步与调度配置线索

- ArticleSummaryRecoveryScheduler (backend/src/main/java/com/frontierscan/article/ArticleSummaryRecoveryScheduler.java)

## 待增强说明

需要 AI 审核：请补充环境变量、默认值、生产风险和降级行为。
