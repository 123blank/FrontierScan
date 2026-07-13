---
generated_by: frontier-kb-generate
layer: L1-baseline
area: backend
module: common
doc_type: overview
git_hash: 4ab9c49f8ef459e1ab90bd143c1799fef2a46aa1
source_fingerprint: sha256:99c956d5a210d763f120b72d810cac701140ee3cfc0cb4a14b511df4a9ac278c
generated_at: 2026-07-11T17:38:46.678Z
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

# common 后端模块概览

## 自动识别职责

- 模块路径：`backend/src/main/java/com/frontierscan/common`
- Java 文件数：16
- 类/接口/记录/枚举数量：11
- Controller 数量：2
- Entity 数量：0
- Repository 数量：0

## 主要类

- record ApiResponse (backend/src/main/java/com/frontierscan/common/api/ApiResponse.java)
- class PingController (backend/src/main/java/com/frontierscan/common/api/PingController.java)
- class AsyncConfig (backend/src/main/java/com/frontierscan/common/config/AsyncConfig.java)
- class DataInitializer (backend/src/main/java/com/frontierscan/common/config/DataInitializer.java)
- class SecurityConfig (backend/src/main/java/com/frontierscan/common/config/SecurityConfig.java)
- class BusinessRuleException (backend/src/main/java/com/frontierscan/common/error/BusinessRuleException.java)
- class GlobalExceptionHandler (backend/src/main/java/com/frontierscan/common/error/GlobalExceptionHandler.java)
- class ResourceNotFoundException (backend/src/main/java/com/frontierscan/common/error/ResourceNotFoundException.java)
- class JwtAuthenticationFilter (backend/src/main/java/com/frontierscan/common/security/JwtAuthenticationFilter.java)
- record JwtPrincipal (backend/src/main/java/com/frontierscan/common/security/JwtPrincipal.java)
- class JwtUtil (backend/src/main/java/com/frontierscan/common/security/JwtUtil.java)

## 语义说明

Needs AI Review: 请结合 L2 语义增强确认该模块的业务边界、核心流程和跨模块依赖。
