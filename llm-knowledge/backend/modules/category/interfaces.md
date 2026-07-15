---
generated_by: frontier-kb-generate
layer: L1-baseline
area: backend
module: category
doc_type: interfaces
git_hash: 8f741538f612f9293972aaff3a81e8c3812b8236
source_fingerprint: sha256:3ee916797c4b6364e522b078f89a697da2144c6b3989aa6836de821d10366ee7
generated_at: 2026-07-15T15:48:15.724Z
baseline_status: fresh
semantic_status: pending
source_files:
  - backend/src/main/java/com/frontierscan/category/Category.java
  - backend/src/main/java/com/frontierscan/category/CategoryController.java
  - backend/src/main/java/com/frontierscan/category/CategoryRepository.java
  - backend/src/main/java/com/frontierscan/category/CategoryService.java
  - backend/src/main/java/com/frontierscan/category/CategoryView.java
  - backend/src/main/java/com/frontierscan/category/package-info.java
---

# category 接口与集成点

## 控制器

- CategoryController：/api/categories (backend/src/main/java/com/frontierscan/category/CategoryController.java)

## HTTP 接口

- GET /api/categories -> CategoryController (backend/src/main/java/com/frontierscan/category/CategoryController.java)
- GET /api/categories/{id} -> CategoryController (backend/src/main/java/com/frontierscan/category/CategoryController.java)
- POST /api/categories -> CategoryController (backend/src/main/java/com/frontierscan/category/CategoryController.java)
- PUT /api/categories/{id} -> CategoryController (backend/src/main/java/com/frontierscan/category/CategoryController.java)
- DELETE /api/categories/{id} -> CategoryController (backend/src/main/java/com/frontierscan/category/CategoryController.java)

## 外部调用与集成提示

需要 AI 审核：自动基线只识别 Spring MVC 注解，复杂参数、权限、响应体和异常语义需由 L2 或人工补充。
