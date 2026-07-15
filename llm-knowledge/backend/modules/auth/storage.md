---
generated_by: frontier-kb-generate
layer: L1-baseline
area: backend
module: auth
doc_type: storage
git_hash: 8f741538f612f9293972aaff3a81e8c3812b8236
source_fingerprint: sha256:8c3fbb52cd829b48dfadadefb099fac71ed8a3f969c81464adb48ac29160c2c3
generated_at: 2026-07-15T15:48:15.724Z
baseline_status: fresh
semantic_status: pending
source_files:
  - backend/src/main/java/com/frontierscan/auth/AuthController.java
  - backend/src/main/java/com/frontierscan/auth/AuthService.java
  - backend/src/main/java/com/frontierscan/auth/UserAccount.java
  - backend/src/main/java/com/frontierscan/auth/UserAccountRepository.java
  - backend/src/main/java/com/frontierscan/auth/package-info.java
---

# auth 存储基线

## 实体与数据表

- UserAccount -> app_users (backend/src/main/java/com/frontierscan/auth/UserAccount.java)

## 数据仓库与映射器

- UserAccountRepository (backend/src/main/java/com/frontierscan/auth/UserAccountRepository.java)

## 待增强说明

需要 AI 审核：请结合 Flyway 迁移、索引、约束和查询模式补充数据语义。
