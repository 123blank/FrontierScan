---
generated_by: frontier-kb-generate
layer: L1-baseline
area: frontend
module: router
doc_type: routes
git_hash: 2b15e640d9f0f6e5be179dee838b3cb70784470e
source_fingerprint: sha256:d59711cb9e3ee9df5746bdf92b9bdfde7419a924b1a27cacb1cf9504a1008ad8
generated_at: 2026-07-16T15:13:11.540Z
baseline_status: fresh
semantic_status: pending
source_files:
  - frontend/src/router/index.ts
---

# router 路由基线

- /login -> login (frontend/src/router/index.ts)
- / -> dashboard (frontend/src/router/index.ts)
- categories -> categories (frontend/src/router/index.ts)
- sites -> sites (frontend/src/router/index.ts)
- favorites -> favorites (frontend/src/router/index.ts)
- collection-runs -> collectionRuns (frontend/src/router/index.ts)

## 路由守卫

- beforeEach (frontend/src/router/index.ts)
- requiresAuth=true (frontend/src/router/index.ts)

需要 AI 审核：权限跳转和布局关系需结合源码进一步确认。
