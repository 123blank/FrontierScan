---
generated_by: frontier-kb-generate
layer: L1-baseline
area: backend
module: auth
doc_type: dependencies
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

# auth 依赖基线

## 识别到的 imports

- com.frontierscan.common.api.ApiResponse
- com.frontierscan.common.security.JwtPrincipal
- com.frontierscan.common.security.JwtUtil
- jakarta.persistence.Column
- jakarta.persistence.Entity
- jakarta.persistence.GeneratedValue
- jakarta.persistence.GenerationType
- jakarta.persistence.Id
- jakarta.persistence.Table
- jakarta.validation.Valid
- jakarta.validation.constraints.NotBlank
- java.time.OffsetDateTime
- java.util.Map
- java.util.Optional
- lombok.AllArgsConstructor
- lombok.Data
- lombok.NoArgsConstructor
- org.springframework.data.jpa.repository.JpaRepository
- org.springframework.security.core.annotation.AuthenticationPrincipal
- org.springframework.security.crypto.password.PasswordEncoder
- org.springframework.stereotype.Service
- org.springframework.web.bind.annotation.PostMapping
- org.springframework.web.bind.annotation.RequestBody
- org.springframework.web.bind.annotation.RequestMapping
- org.springframework.web.bind.annotation.RestController

## 待增强说明

Needs AI Review: 请区分框架依赖、业务依赖、外部服务依赖和测试替身。
