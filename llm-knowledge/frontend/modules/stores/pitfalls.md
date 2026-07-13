---
generated_by: frontier-kb-generate
layer: L1-baseline
area: frontend
module: stores
doc_type: pitfalls
git_hash: 4ab9c49f8ef459e1ab90bd143c1799fef2a46aa1
source_fingerprint: sha256:596930eaa00e0e4f014a56a496bcbd23b7238175ba20e09faf4573e1218d4833
generated_at: 2026-07-11T17:38:46.678Z
baseline_status: fresh
semantic_status: pending
source_files:
  - frontend/src/stores/auth.ts
---

# stores 风险与注意事项

- 存在后端 API 依赖，需关注空态、错误态、鉴权过期和契约变化。

Needs AI Review: 请补充页面级业务风险、测试缺口和已知 UI 陷阱。
