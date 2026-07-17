---
generated_by: frontier-kb-generate
layer: L1-baseline
area: backend
module: auth
doc_type: overview
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

# auth 后端模块概览

## 自动识别职责

- 模块路径：`backend/src/main/java/com/frontierscan/auth`
- Java 文件数：5
- 类/接口/记录/枚举数量：6
- 控制器数量：1
- 实体数量：1
- 数据仓库数量：1

## 主要类

- class AuthController (backend/src/main/java/com/frontierscan/auth/AuthController.java)
- record LoginRequest (backend/src/main/java/com/frontierscan/auth/AuthController.java)
- class AuthService (backend/src/main/java/com/frontierscan/auth/AuthService.java)
- record LoginResult (backend/src/main/java/com/frontierscan/auth/AuthService.java)
- class UserAccount (backend/src/main/java/com/frontierscan/auth/UserAccount.java)
- interface UserAccountRepository (backend/src/main/java/com/frontierscan/auth/UserAccountRepository.java)

## 语义说明

需要 AI 审核：请结合 L2 语义增强确认该模块的业务边界、核心流程和跨模块依赖。
