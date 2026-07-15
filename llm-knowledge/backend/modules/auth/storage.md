---
generated_by: frontier-kb-generate
layer: L1-baseline
area: backend
module: auth
doc_type: storage
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

# auth 存储基线

## 实体与数据表

- UserAccount -> app_users (backend/src/main/java/com/frontierscan/auth/UserAccount.java)

## 数据仓库与映射器

- UserAccountRepository (backend/src/main/java/com/frontierscan/auth/UserAccountRepository.java)

## 待增强说明

需要 AI 审核：请结合 Flyway 迁移、索引、约束和查询模式补充数据语义。
