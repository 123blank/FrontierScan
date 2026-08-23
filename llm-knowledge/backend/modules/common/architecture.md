---
generated_by: frontier-kb-generate
layer: L1-baseline
area: backend
module: common
doc_type: architecture
git_hash: 6c3553298fe6e6b638a221c689eaf794f6dfa87a
source_fingerprint: sha256:854b810c1118d4fbf129a57c0d1d9b541762b554577a3eb592e62c00173c2f11
generated_at: 2026-08-23T10:10:03.337Z
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

# common 架构基线

## 模块内部结构

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

## 定时与异步执行

- AsyncConfig -> frontierScanCollectionExecutor (backend/src/main/java/com/frontierscan/common/config/AsyncConfig.java)

## 待增强说明

需要 AI 审核：请补充核心调用链、事务边界、异步补偿流程和跨模块协作方式。
