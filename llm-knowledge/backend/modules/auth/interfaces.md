---
generated_by: frontier-kb-generate
layer: L1-baseline
area: backend
module: auth
doc_type: interfaces
git_hash: dfbb39a87e15c337796a7f2fb38cf48430fe769e
generated_at: 2026-07-06T09:39:30.103Z
baseline_status: fresh
semantic_status: pending
source_files:
  - backend/src/main/java/com/frontierscan/auth/AuthController.java
  - backend/src/main/java/com/frontierscan/auth/AuthService.java
  - backend/src/main/java/com/frontierscan/auth/UserAccount.java
  - backend/src/main/java/com/frontierscan/auth/UserAccountRepository.java
  - backend/src/main/java/com/frontierscan/auth/package-info.java
---

# auth 接口与集成点

## Controllers

- AuthController：/api/auth (backend/src/main/java/com/frontierscan/auth/AuthController.java)

## HTTP Endpoints

- POST /api/auth/login -> AuthController (backend/src/main/java/com/frontierscan/auth/AuthController.java)
- POST /api/auth/me -> AuthController (backend/src/main/java/com/frontierscan/auth/AuthController.java)

## 外部调用/集成提示

Needs AI Review: 自动基线只识别 Spring MVC 注解，复杂参数、权限、响应体和异常语义需由 L2 或人工补充。
