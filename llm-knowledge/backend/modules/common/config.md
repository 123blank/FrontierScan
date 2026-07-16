---
generated_by: frontier-kb-generate
layer: L1-baseline
area: backend
module: common
doc_type: config
git_hash: 2bcaa65e73d02ab23d884f93e1640a7459fe1c46
source_fingerprint: sha256:854b810c1118d4fbf129a57c0d1d9b541762b554577a3eb592e62c00173c2f11
generated_at: 2026-07-16T08:51:47.497Z
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

## 配置属性

- 暂无自动识别结果。

## 异步与调度配置线索

- AsyncConfig -> frontierScanCollectionExecutor (backend/src/main/java/com/frontierscan/common/config/AsyncConfig.java)

## 待增强说明

需要 AI 审核：请补充环境变量、默认值、生产风险和降级行为。
