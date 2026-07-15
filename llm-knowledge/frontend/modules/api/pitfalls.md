---
generated_by: frontier-kb-generate
layer: L1-baseline
area: frontend
module: api
doc_type: pitfalls
git_hash: cb5edb5cde7a1635447198f2e2bedc8c3ee225e9
source_fingerprint: sha256:3e142de410653b7af917a1ce1d4ed598a58ccd3b2032b732bb3aa148c2fa1e70
generated_at: 2026-07-15T15:00:02.197Z
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

# api 风险与注意事项

- 存在后端 API 依赖，需关注空态、错误态、鉴权过期和契约变化。

需要 AI 审核：请补充页面级业务风险、测试缺口和已知 UI 陷阱。
