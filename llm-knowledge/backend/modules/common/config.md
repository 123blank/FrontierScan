---
generated_by: frontier-kb-generate
layer: L1-baseline
area: backend
module: common
doc_type: config
git_hash: 50253a205e583bc24faab6c8f50cdcf352ddae23
source_fingerprint: sha256:99c956d5a210d763f120b72d810cac701140ee3cfc0cb4a14b511df4a9ac278c
generated_at: 2026-07-15T03:45:44.398Z
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

# common 配置基线

## Configuration Properties

- 暂无自动识别结果。

## 异步/调度配置线索

- AsyncConfig -> frontierScanCollectionExecutor (backend/src/main/java/com/frontierscan/common/config/AsyncConfig.java)

## 待增强说明

Needs AI Review: 请补充环境变量、默认值、生产风险和降级行为。
