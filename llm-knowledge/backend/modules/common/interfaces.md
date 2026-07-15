---
generated_by: frontier-kb-generate
layer: L1-baseline
area: backend
module: common
doc_type: interfaces
git_hash: 8f741538f612f9293972aaff3a81e8c3812b8236
source_fingerprint: sha256:854b810c1118d4fbf129a57c0d1d9b541762b554577a3eb592e62c00173c2f11
generated_at: 2026-07-15T15:48:15.724Z
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

# common 接口与集成点

## 控制器

- PingController：/api (backend/src/main/java/com/frontierscan/common/api/PingController.java)
- GlobalExceptionHandler：(root) (backend/src/main/java/com/frontierscan/common/error/GlobalExceptionHandler.java)

## HTTP 接口

- GET /api/ping -> PingController (backend/src/main/java/com/frontierscan/common/api/PingController.java)

## 外部调用与集成提示

需要 AI 审核：自动基线只识别 Spring MVC 注解，复杂参数、权限、响应体和异常语义需由 L2 或人工补充。
