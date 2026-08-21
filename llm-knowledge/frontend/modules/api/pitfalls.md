---
generated_by: frontier-kb-generate
layer: L1-baseline
area: frontend
module: api
doc_type: pitfalls
git_hash: b98a55a7e288933d966c69acc854b13bae1c001d
source_fingerprint: sha256:0fc4832ffc61a9dfb5cdb9dbcefe9e6a1bad9c7ac2d22a61cb8adabb9e5ae2df
generated_at: 2026-08-21T09:54:30.279Z
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
