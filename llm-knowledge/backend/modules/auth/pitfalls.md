---
generated_by: frontier-kb-generate
layer: L1-baseline
area: backend
module: auth
doc_type: pitfalls
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

# auth 风险与注意事项

## 自动识别风险线索

- 存在对外 HTTP API，需关注鉴权、参数校验和响应兼容性。
- 存在持久化实体，需关注 migration、索引和数据兼容。

## 待增强说明

需要 AI 审核：请结合线上故障、测试缺口和业务规则补充真实风险。
