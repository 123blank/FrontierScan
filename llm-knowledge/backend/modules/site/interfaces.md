---
generated_by: frontier-kb-generate
layer: L1-baseline
area: backend
module: site
doc_type: interfaces
git_hash: dfbb39a87e15c337796a7f2fb38cf48430fe769e
generated_at: 2026-07-06T09:39:30.103Z
baseline_status: fresh
semantic_status: pending
source_files:
  - backend/src/main/java/com/frontierscan/site/Site.java
  - backend/src/main/java/com/frontierscan/site/SiteController.java
  - backend/src/main/java/com/frontierscan/site/SiteRepository.java
  - backend/src/main/java/com/frontierscan/site/SiteService.java
  - backend/src/main/java/com/frontierscan/site/package-info.java
---

# site 接口与集成点

## Controllers

- SiteController：/api/sites (backend/src/main/java/com/frontierscan/site/SiteController.java)

## HTTP Endpoints

- GET /api/sites -> SiteController (backend/src/main/java/com/frontierscan/site/SiteController.java)
- GET /api/sites/{id} -> SiteController (backend/src/main/java/com/frontierscan/site/SiteController.java)
- POST /api/sites -> SiteController (backend/src/main/java/com/frontierscan/site/SiteController.java)
- PUT /api/sites/{id} -> SiteController (backend/src/main/java/com/frontierscan/site/SiteController.java)
- DELETE /api/sites/{id} -> SiteController (backend/src/main/java/com/frontierscan/site/SiteController.java)

## 外部调用/集成提示

Needs AI Review: 自动基线只识别 Spring MVC 注解，复杂参数、权限、响应体和异常语义需由 L2 或人工补充。
