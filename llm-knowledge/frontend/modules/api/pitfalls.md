---
generated_by: frontier-kb-generate
layer: L1-baseline
area: frontend
module: api
doc_type: pitfalls
git_hash: 8f741538f612f9293972aaff3a81e8c3812b8236
source_fingerprint: sha256:eac33941cb0b45f792cbff9bba24aab06f97034a44c3d8aec30061a333b04db9
generated_at: 2026-07-15T15:48:15.724Z
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
