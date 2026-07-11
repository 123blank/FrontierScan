---
generated_by: frontier-kb-generate
layer: L1-baseline
area: frontend
module: views
doc_type: components
git_hash: 4ab9d045a22ba2f5b92b19ec2f8c37ae327556a4
generated_at: 2026-07-11T10:45:43.312Z
baseline_status: fresh
semantic_status: pending
source_files:
  - frontend/src/views/CategoriesView.vue
  - frontend/src/views/CollectionRunsView.vue
  - frontend/src/views/DashboardView.vue
  - frontend/src/views/FavoritesView.vue
  - frontend/src/views/LoginView.vue
  - frontend/src/views/SitesView.vue
---

# views 组件基线

- CategoriesView.vue (frontend/src/views/CategoriesView.vue)
- CollectionRunsView.vue (frontend/src/views/CollectionRunsView.vue)
- DashboardView.vue (frontend/src/views/DashboardView.vue)
- FavoritesView.vue (frontend/src/views/FavoritesView.vue)
- LoginView.vue (frontend/src/views/LoginView.vue)
- SitesView.vue (frontend/src/views/SitesView.vue)

## Exports

- 暂无自动识别结果。

## 页面到 API 依赖

- categoryApi -> api/categories (frontend/src/views/CategoriesView.vue)
- collectionRunApi -> api/collectionRuns (frontend/src/views/CollectionRunsView.vue)
- articleApi -> api/articles (frontend/src/views/DashboardView.vue)
- categoryApi -> api/categories (frontend/src/views/DashboardView.vue)
- siteApi -> api/sites (frontend/src/views/DashboardView.vue)
- articleApi -> api/articles (frontend/src/views/FavoritesView.vue)
- siteApi -> api/sites (frontend/src/views/SitesView.vue)
- categoryApi -> api/categories (frontend/src/views/SitesView.vue)
- collectionRunApi -> api/collectionRuns (frontend/src/views/SitesView.vue)

Needs AI Review: 组件职责、复用边界、表格/弹窗/筛选交互需补充。
