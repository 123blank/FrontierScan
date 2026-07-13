---
generated_by: frontier-kb-generate
layer: L1-baseline
area: backend
module: collection
doc_type: interfaces
git_hash: 4ab9c49f8ef459e1ab90bd143c1799fef2a46aa1
source_fingerprint: sha256:989e52a4506cb7a3a3f671a7d940614b1270a0f23460cd17c63d2f182d89b958
generated_at: 2026-07-11T17:38:46.678Z
baseline_status: fresh
semantic_status: pending
source_files:
  - backend/src/main/java/com/frontierscan/collection/ArticleParser.java
  - backend/src/main/java/com/frontierscan/collection/CollectResult.java
  - backend/src/main/java/com/frontierscan/collection/CollectionFailureClassifier.java
  - backend/src/main/java/com/frontierscan/collection/CollectionOrchestrator.java
  - backend/src/main/java/com/frontierscan/collection/CollectionRun.java
  - backend/src/main/java/com/frontierscan/collection/CollectionRunController.java
  - backend/src/main/java/com/frontierscan/collection/CollectionRunRepository.java
  - backend/src/main/java/com/frontierscan/collection/CollectionRunService.java
  - backend/src/main/java/com/frontierscan/collection/CollectionScheduleProperties.java
  - backend/src/main/java/com/frontierscan/collection/CollectionScheduler.java
  - backend/src/main/java/com/frontierscan/collection/Collector.java
  - backend/src/main/java/com/frontierscan/collection/CollectorException.java
  - backend/src/main/java/com/frontierscan/collection/ConnectionTimeoutException.java
  - backend/src/main/java/com/frontierscan/collection/EmptyResultException.java
  - backend/src/main/java/com/frontierscan/collection/HtmlCollector.java
  - backend/src/main/java/com/frontierscan/collection/ParseException.java
  - backend/src/main/java/com/frontierscan/collection/RssCollector.java
  - backend/src/main/java/com/frontierscan/collection/TagEvaluationAsyncService.java
  - backend/src/main/java/com/frontierscan/collection/package-info.java
---

# collection 接口与集成点

## Controllers

- CollectionRunController：/api/collection-runs (backend/src/main/java/com/frontierscan/collection/CollectionRunController.java)

## HTTP Endpoints

- GET /api/collection-runs -> CollectionRunController (backend/src/main/java/com/frontierscan/collection/CollectionRunController.java)
- GET /api/collection-runs/{runId} -> CollectionRunController (backend/src/main/java/com/frontierscan/collection/CollectionRunController.java)
- POST /api/collection-runs/{runId}/retry -> CollectionRunController (backend/src/main/java/com/frontierscan/collection/CollectionRunController.java)
- POST /api/collection-runs/sites/{siteId} -> CollectionRunController (backend/src/main/java/com/frontierscan/collection/CollectionRunController.java)

## 外部调用/集成提示

Needs AI Review: 自动基线只识别 Spring MVC 注解，复杂参数、权限、响应体和异常语义需由 L2 或人工补充。
