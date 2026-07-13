---
generated_by: frontier-kb-generate
layer: L1-baseline
area: backend
module: auth
doc_type: interfaces
git_hash: 4ab9c49f8ef459e1ab90bd143c1799fef2a46aa1
source_fingerprint: sha256:2cf816b9b9819e4d244816bf1c39b3c4ea477f229593acf79737585b70fc2afa
generated_at: 2026-07-11T17:38:46.678Z
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
