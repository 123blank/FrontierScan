---
generated_by: frontier-kb-generate
layer: L1-baseline
area: backend
module: auth
doc_type: interfaces
git_hash: 2b15e640d9f0f6e5be179dee838b3cb70784470e
source_fingerprint: sha256:8c3fbb52cd829b48dfadadefb099fac71ed8a3f969c81464adb48ac29160c2c3
generated_at: 2026-07-16T15:13:11.540Z
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
