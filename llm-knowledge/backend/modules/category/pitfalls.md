---
generated_by: frontier-kb-generate
layer: L1-baseline
area: backend
module: category
doc_type: pitfalls
git_hash: dfbb39a87e15c337796a7f2fb38cf48430fe769e
generated_at: 2026-07-06T09:39:30.103Z
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

# category 风险与注意事项

## 自动识别风险线索

- 存在对外 HTTP API，需关注鉴权、参数校验和响应兼容性。
- 存在持久化实体，需关注 migration、索引和数据兼容。

## 待增强说明

Needs AI Review: 请结合线上故障、测试缺口和业务规则补充真实风险。
