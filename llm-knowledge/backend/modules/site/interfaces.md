---
generated_by: frontier-kb-generate
layer: L1-baseline
area: backend
module: site
doc_type: interfaces
git_hash: 2b15e640d9f0f6e5be179dee838b3cb70784470e
source_fingerprint: sha256:0f137b56d2824a635b53478d74f9373977fb4f93ef5ce7b80628079579343197
generated_at: 2026-07-16T15:13:11.540Z
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

## 控制器

- SiteController：/api/sites (backend/src/main/java/com/frontierscan/site/SiteController.java)

## HTTP 接口

- GET /api/sites -> SiteController (backend/src/main/java/com/frontierscan/site/SiteController.java)
- GET /api/sites/{id} -> SiteController (backend/src/main/java/com/frontierscan/site/SiteController.java)
- POST /api/sites -> SiteController (backend/src/main/java/com/frontierscan/site/SiteController.java)
- PUT /api/sites/{id} -> SiteController (backend/src/main/java/com/frontierscan/site/SiteController.java)
- DELETE /api/sites/{id} -> SiteController (backend/src/main/java/com/frontierscan/site/SiteController.java)

## 外部调用与集成提示

需要 AI 审核：自动基线只识别 Spring MVC 注解，复杂参数、权限、响应体和异常语义需由 L2 或人工补充。
