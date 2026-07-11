---
generated_by: frontier-kb-generate
layer: L1-baseline
area: frontend
module: api
doc_type: api-usage
git_hash: 4ab9d045a22ba2f5b92b19ec2f8c37ae327556a4
generated_at: 2026-07-11T10:45:43.312Z
baseline_status: fresh
semantic_status: pending
source_files:
  - frontend/src/api/articles.ts
  - frontend/src/api/categories.ts
  - frontend/src/api/client.ts
  - frontend/src/api/collectionRuns.ts
  - frontend/src/api/sites.ts
  - frontend/src/api/tags.ts
---

# api API 使用基线

- GET /articles (frontend/src/api/articles.ts)
- GET /articles/${id} (frontend/src/api/articles.ts)
- POST /articles/${id}/summary/retry (frontend/src/api/articles.ts)
- POST /articles/${id}/favorite (frontend/src/api/articles.ts)
- DELETE /articles/${id}/favorite (frontend/src/api/articles.ts)
- GET /articles/favorites (frontend/src/api/articles.ts)
- GET /articles/count (frontend/src/api/articles.ts)
- GET /categories (frontend/src/api/categories.ts)
- GET /categories/${id} (frontend/src/api/categories.ts)
- POST /categories (frontend/src/api/categories.ts)
- PUT /categories/${id} (frontend/src/api/categories.ts)
- DELETE /categories/${id} (frontend/src/api/categories.ts)
- GET /collection-runs (frontend/src/api/collectionRuns.ts)
- GET /collection-runs/${runId} (frontend/src/api/collectionRuns.ts)
- POST /collection-runs/${runId}/retry (frontend/src/api/collectionRuns.ts)
- POST /collection-runs/sites/${siteId} (frontend/src/api/collectionRuns.ts)
- GET /sites (frontend/src/api/sites.ts)
- GET /sites/${id} (frontend/src/api/sites.ts)
- POST /sites (frontend/src/api/sites.ts)
- PUT /sites/${id} (frontend/src/api/sites.ts)
- DELETE /sites/${id} (frontend/src/api/sites.ts)
- GET /tags/domains (frontend/src/api/tags.ts)
- GET /tags/domains/${domainName} (frontend/src/api/tags.ts)

Needs AI Review: 请求参数、错误处理、加载状态和后端契约兼容性需补充。
