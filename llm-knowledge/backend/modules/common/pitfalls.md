---
generated_by: frontier-kb-generate
layer: L1-baseline
area: backend
module: common
doc_type: pitfalls
git_hash: cb5edb5cde7a1635447198f2e2bedc8c3ee225e9
source_fingerprint: sha256:99c956d5a210d763f120b72d810cac701140ee3cfc0cb4a14b511df4a9ac278c
generated_at: 2026-07-15T15:00:02.197Z
baseline_status: fresh
semantic_status: pending
source_files:
  - backend/src/main/java/com/frontierscan/common/api/ApiResponse.java
  - backend/src/main/java/com/frontierscan/common/api/PingController.java
  - backend/src/main/java/com/frontierscan/common/api/package-info.java
  - backend/src/main/java/com/frontierscan/common/config/AsyncConfig.java
  - backend/src/main/java/com/frontierscan/common/config/DataInitializer.java
  - backend/src/main/java/com/frontierscan/common/config/SecurityConfig.java
  - backend/src/main/java/com/frontierscan/common/config/package-info.java
  - backend/src/main/java/com/frontierscan/common/error/BusinessRuleException.java
  - backend/src/main/java/com/frontierscan/common/error/GlobalExceptionHandler.java
  - backend/src/main/java/com/frontierscan/common/error/ResourceNotFoundException.java
  - backend/src/main/java/com/frontierscan/common/error/package-info.java
  - backend/src/main/java/com/frontierscan/common/package-info.java
  - backend/src/main/java/com/frontierscan/common/security/JwtAuthenticationFilter.java
  - backend/src/main/java/com/frontierscan/common/security/JwtPrincipal.java
  - backend/src/main/java/com/frontierscan/common/security/JwtUtil.java
  - backend/src/main/java/com/frontierscan/common/security/package-info.java
---

# common 风险与注意事项

## 自动识别风险线索

- 存在对外 HTTP API，需关注鉴权、参数校验和响应兼容性。
- 存在异步执行，需关注线程池、事务上下文和异常传播。

## 待增强说明

需要 AI 审核：请结合线上故障、测试缺口和业务规则补充真实风险。
