---
generated_by: frontier-kb-generate
layer: L1-baseline
area: backend
module: auth
doc_type: interfaces
git_hash: cb5edb5cde7a1635447198f2e2bedc8c3ee225e9
source_fingerprint: sha256:2cf816b9b9819e4d244816bf1c39b3c4ea477f229593acf79737585b70fc2afa
generated_at: 2026-07-15T15:00:02.197Z
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

## 控制器

- AuthController：/api/auth (backend/src/main/java/com/frontierscan/auth/AuthController.java)

## HTTP 接口

- POST /api/auth/login -> AuthController (backend/src/main/java/com/frontierscan/auth/AuthController.java)
- POST /api/auth/me -> AuthController (backend/src/main/java/com/frontierscan/auth/AuthController.java)

## 外部调用与集成提示

需要 AI 审核：自动基线只识别 Spring MVC 注解，复杂参数、权限、响应体和异常语义需由 L2 或人工补充。
