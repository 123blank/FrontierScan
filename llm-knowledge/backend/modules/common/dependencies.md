---
generated_by: frontier-kb-generate
layer: L1-baseline
area: backend
module: common
doc_type: dependencies
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

# common 依赖基线

## 识别到的 imports

- com.frontierscan.auth.AuthService
- com.frontierscan.common.api.ApiResponse
- com.frontierscan.common.security.JwtAuthenticationFilter
- com.frontierscan.llm.LlmProperties
- io.jsonwebtoken.Claims
- io.jsonwebtoken.Jwts
- io.jsonwebtoken.security.Keys
- jakarta.servlet.FilterChain
- jakarta.servlet.ServletException
- jakarta.servlet.http.HttpServletRequest
- jakarta.servlet.http.HttpServletResponse
- jakarta.validation.ConstraintViolationException
- java.io.IOException
- java.nio.charset.StandardCharsets
- java.time.Instant
- java.util.Date
- java.util.List
- java.util.Map
- java.util.concurrent.Executor
- java.util.concurrent.ThreadPoolExecutor
- javax.crypto.SecretKey
- org.slf4j.Logger
- org.slf4j.LoggerFactory
- org.springframework.beans.factory.annotation.Value
- org.springframework.boot.CommandLineRunner
- org.springframework.context.annotation.Bean
- org.springframework.context.annotation.Configuration
- org.springframework.http.HttpMethod
- org.springframework.http.HttpStatus
- org.springframework.http.ResponseEntity
- org.springframework.scheduling.annotation.EnableAsync
- org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor
- org.springframework.security.access.AccessDeniedException
- org.springframework.security.authentication.UsernamePasswordAuthenticationToken
- org.springframework.security.config.Customizer
- org.springframework.security.config.annotation.web.builders.HttpSecurity
- org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer
- org.springframework.security.config.http.SessionCreationPolicy
- org.springframework.security.core.context.SecurityContextHolder
- org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder
- org.springframework.security.crypto.password.PasswordEncoder
- org.springframework.security.web.SecurityFilterChain
- org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter
- org.springframework.security.web.authentication.WebAuthenticationDetailsSource
- org.springframework.stereotype.Component
- org.springframework.util.StringUtils
- org.springframework.web.bind.MethodArgumentNotValidException
- org.springframework.web.bind.annotation.ExceptionHandler
- org.springframework.web.bind.annotation.GetMapping
- org.springframework.web.bind.annotation.RequestMapping

## 待增强说明

Needs AI Review: 请区分框架依赖、业务依赖、外部服务依赖和测试替身。
