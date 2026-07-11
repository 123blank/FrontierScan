---
generated_by: frontier-kb-generate
layer: L1-baseline
area: backend
module: category
doc_type: interfaces
git_hash: dfbb39a87e15c337796a7f2fb38cf48430fe769e
generated_at: 2026-07-06T09:39:30.103Z
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

## Controllers

- CategoryController：/api/categories (backend/src/main/java/com/frontierscan/category/CategoryController.java)

## HTTP Endpoints

- GET /api/categories -> CategoryController (backend/src/main/java/com/frontierscan/category/CategoryController.java)
- GET /api/categories/{id} -> CategoryController (backend/src/main/java/com/frontierscan/category/CategoryController.java)
- POST /api/categories -> CategoryController (backend/src/main/java/com/frontierscan/category/CategoryController.java)
- PUT /api/categories/{id} -> CategoryController (backend/src/main/java/com/frontierscan/category/CategoryController.java)
- DELETE /api/categories/{id} -> CategoryController (backend/src/main/java/com/frontierscan/category/CategoryController.java)

## 外部调用/集成提示

Needs AI Review: 自动基线只识别 Spring MVC 注解，复杂参数、权限、响应体和异常语义需由 L2 或人工补充。
