---
generated_by: frontier-kb-generate
layer: L1-baseline
area: backend
module: article
doc_type: storage
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

# article 存储基线

## Entities / Tables

- Article -> articles (backend/src/main/java/com/frontierscan/article/Article.java)
- Favorite -> favorites (backend/src/main/java/com/frontierscan/article/Favorite.java)

## Repositories / Mappers

- ArticleRepository (backend/src/main/java/com/frontierscan/article/ArticleRepository.java)
- FavoriteRepository (backend/src/main/java/com/frontierscan/article/FavoriteRepository.java)

## 待增强说明

Needs AI Review: 请结合 Flyway migration、索引、约束和查询模式补充数据语义。
