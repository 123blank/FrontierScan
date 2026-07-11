---
generated_by: frontier-kb-generate
layer: L1-baseline
area: frontend
module: stores
doc_type: pitfalls
git_hash: 4ab9d045a22ba2f5b92b19ec2f8c37ae327556a4
generated_at: 2026-07-11T10:45:43.312Z
baseline_status: fresh
semantic_status: pending
source_files:
  - frontend/src/stores/auth.ts
---

# stores 风险与注意事项

- 存在后端 API 依赖，需关注空态、错误态、鉴权过期和契约变化。

Needs AI Review: 请补充页面级业务风险、测试缺口和已知 UI 陷阱。
