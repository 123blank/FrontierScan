---
generated_by: frontier-kb-generate
layer: L1-baseline
area: frontend
module: router
doc_type: routes
git_hash: 50253a205e583bc24faab6c8f50cdcf352ddae23
source_fingerprint: sha256:d59711cb9e3ee9df5746bdf92b9bdfde7419a924b1a27cacb1cf9504a1008ad8
generated_at: 2026-07-15T03:45:44.398Z
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

Needs AI Review: 权限跳转和布局关系需结合源码进一步确认。
