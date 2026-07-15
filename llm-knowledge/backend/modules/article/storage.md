---
generated_by: frontier-kb-generate
layer: L1-baseline
area: backend
module: article
doc_type: storage
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

# article 存储基线

## 实体与数据表

- Article -> articles (backend/src/main/java/com/frontierscan/article/Article.java)
- Favorite -> favorites (backend/src/main/java/com/frontierscan/article/Favorite.java)

## 数据仓库与映射器

- ArticleRepository (backend/src/main/java/com/frontierscan/article/ArticleRepository.java)
- FavoriteRepository (backend/src/main/java/com/frontierscan/article/FavoriteRepository.java)

## 待增强说明

需要 AI 审核：请结合 Flyway 迁移、索引、约束和查询模式补充数据语义。
