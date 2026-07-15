---
generated_by: frontier-kb-generate
layer: L1-baseline
area: backend
module: category
doc_type: dependencies
git_hash: 50253a205e583bc24faab6c8f50cdcf352ddae23
source_fingerprint: sha256:bf542397a093edd156fb9223292162dcc41b0ec444379ab679282c4ea32c9137
generated_at: 2026-07-15T03:45:44.398Z
baseline_status: fresh
semantic_status: pending
source_files:
  - backend/src/main/java/com/frontierscan/category/Category.java
  - backend/src/main/java/com/frontierscan/category/CategoryController.java
  - backend/src/main/java/com/frontierscan/category/CategoryRepository.java
  - backend/src/main/java/com/frontierscan/category/CategoryService.java
  - backend/src/main/java/com/frontierscan/category/CategoryView.java
  - backend/src/main/java/com/frontierscan/category/package-info.java
---

# category 依赖基线

## 识别到的 imports

- com.frontierscan.article.ArticleRepository
- com.frontierscan.common.api.ApiResponse
- com.frontierscan.common.error.BusinessRuleException
- com.frontierscan.common.error.ResourceNotFoundException
- com.frontierscan.common.security.JwtPrincipal
- com.frontierscan.site.SiteRepository
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

Needs AI Review: 请区分框架依赖、业务依赖、外部服务依赖和测试替身。
