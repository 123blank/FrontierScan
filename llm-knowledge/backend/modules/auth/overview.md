---
generated_by: frontier-kb-generate
layer: L1-baseline
area: backend
module: auth
doc_type: overview
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

# auth 后端模块概览

## 自动识别职责

- 模块路径：`backend/src/main/java/com/frontierscan/auth`
- Java 文件数：5
- 类/接口/记录/枚举数量：6
- Controller 数量：1
- Entity 数量：1
- Repository 数量：1

## 主要类

- class AuthController (backend/src/main/java/com/frontierscan/auth/AuthController.java)
- record LoginRequest (backend/src/main/java/com/frontierscan/auth/AuthController.java)
- class AuthService (backend/src/main/java/com/frontierscan/auth/AuthService.java)
- record LoginResult (backend/src/main/java/com/frontierscan/auth/AuthService.java)
- class UserAccount (backend/src/main/java/com/frontierscan/auth/UserAccount.java)
- interface UserAccountRepository (backend/src/main/java/com/frontierscan/auth/UserAccountRepository.java)

## 语义说明

Needs AI Review: 请结合 L2 语义增强确认该模块的业务边界、核心流程和跨模块依赖。
