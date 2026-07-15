---
generated_by: frontier-kb-generate
layer: L1-baseline
area: backend
module: auth
doc_type: storage
git_hash: 50253a205e583bc24faab6c8f50cdcf352ddae23
source_fingerprint: sha256:2cf816b9b9819e4d244816bf1c39b3c4ea477f229593acf79737585b70fc2afa
generated_at: 2026-07-15T03:45:44.398Z
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

## Entities / Tables

- UserAccount -> app_users (backend/src/main/java/com/frontierscan/auth/UserAccount.java)

## Repositories / Mappers

- UserAccountRepository (backend/src/main/java/com/frontierscan/auth/UserAccountRepository.java)

## 待增强说明

Needs AI Review: 请结合 Flyway migration、索引、约束和查询模式补充数据语义。
