---
generated_by: frontier-kb-generate
layer: L1-baseline
area: backend
module: auth
doc_type: storage
git_hash: 4ab9d045a22ba2f5b92b19ec2f8c37ae327556a4
generated_at: 2026-07-11T10:45:43.312Z
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
