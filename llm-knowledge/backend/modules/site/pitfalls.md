---
generated_by: frontier-kb-generate
layer: L1-baseline
area: backend
module: site
doc_type: pitfalls
git_hash: 50253a205e583bc24faab6c8f50cdcf352ddae23
source_fingerprint: sha256:6b06e3ccfb0621bc70a349bbdb45986b647f00b22e5af6b9cb9b3021b1ec9242
generated_at: 2026-07-15T03:45:44.398Z
baseline_status: fresh
semantic_status: pending
source_files:
  - backend/src/main/java/com/frontierscan/site/Site.java
  - backend/src/main/java/com/frontierscan/site/SiteController.java
  - backend/src/main/java/com/frontierscan/site/SiteRepository.java
  - backend/src/main/java/com/frontierscan/site/SiteService.java
  - backend/src/main/java/com/frontierscan/site/package-info.java
---

# site 风险与注意事项

## 自动识别风险线索

- 存在对外 HTTP API，需关注鉴权、参数校验和响应兼容性。
- 存在持久化实体，需关注 migration、索引和数据兼容。

## 待增强说明

Needs AI Review: 请结合线上故障、测试缺口和业务规则补充真实风险。
