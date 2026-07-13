---
generated_by: frontier-kb-generate
layer: L1-baseline
area: backend
module: site
doc_type: interfaces
git_hash: 4ab9c49f8ef459e1ab90bd143c1799fef2a46aa1
source_fingerprint: sha256:6b06e3ccfb0621bc70a349bbdb45986b647f00b22e5af6b9cb9b3021b1ec9242
generated_at: 2026-07-11T17:38:46.678Z
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
