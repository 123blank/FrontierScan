---
generated_by: frontier-kb-generate
layer: L1-baseline
area: backend
module: site
doc_type: dependencies
git_hash: 2b15e640d9f0f6e5be179dee838b3cb70784470e
source_fingerprint: sha256:0f137b56d2824a635b53478d74f9373977fb4f93ef5ce7b80628079579343197
generated_at: 2026-07-16T15:13:11.540Z
baseline_status: fresh
semantic_status: pending
source_files:
  - backend/src/main/java/com/frontierscan/site/Site.java
  - backend/src/main/java/com/frontierscan/site/SiteController.java
  - backend/src/main/java/com/frontierscan/site/SiteRepository.java
  - backend/src/main/java/com/frontierscan/site/SiteService.java
  - backend/src/main/java/com/frontierscan/site/package-info.java
---

# site 依赖基线

## 识别到的导入项

- com.frontierscan.category.CategoryRepository
- com.frontierscan.common.api.ApiResponse
- com.frontierscan.common.error.ResourceNotFoundException
- com.frontierscan.common.security.JwtPrincipal
- jakarta.persistence.Column
- jakarta.persistence.Entity
- jakarta.persistence.GeneratedValue
- jakarta.persistence.GenerationType
- jakarta.persistence.Id
- jakarta.persistence.Table
- jakarta.validation.Valid
- jakarta.validation.constraints.NotBlank
- java.time.OffsetDateTime
- java.util.List
- java.util.Map
- java.util.Optional
- lombok.AllArgsConstructor
- lombok.Data
- lombok.NoArgsConstructor
- org.springframework.data.jpa.repository.JpaRepository
- org.springframework.security.core.annotation.AuthenticationPrincipal
- org.springframework.stereotype.Service
- org.springframework.transaction.annotation.Transactional
- org.springframework.web.bind.annotation.DeleteMapping
- org.springframework.web.bind.annotation.GetMapping
- org.springframework.web.bind.annotation.PathVariable
- org.springframework.web.bind.annotation.PostMapping
- org.springframework.web.bind.annotation.PutMapping
- org.springframework.web.bind.annotation.RequestBody
- org.springframework.web.bind.annotation.RequestMapping
- org.springframework.web.bind.annotation.RequestParam
- org.springframework.web.bind.annotation.RestController

## 待增强说明

需要 AI 审核：请区分框架依赖、业务依赖、外部服务依赖和测试替身。
