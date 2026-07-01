# FrontierScan Agent - AI 交接文档

> 本文档目标：让零上下文的新 AI 或工程师在阅读后，能够理解项目现状、关键约定、已完成业务、验证方式和下一步开发方向。
>
> 最后更新：2026-07-01  
> 项目版本：0.1.0-SNAPSHOT  
> 当前重点：采集可靠性增强、LLM 摘要治理一期、全文摘要 Map-Reduce 和标签评分采集流水线均已完成。后续建议进入阅读体验增强、标签系统管理能力完善和账号体系完善。

---

## 1. 项目概述

FrontierScan 是一个前后端分离的企业级 Web Agent 系统，用于采集技术/AI 前沿网站内容，经过大模型摘要后，以文章卡片、详情抽屉和收藏页提供阅读闭环。

### 核心能力

1. 信息源管理：用户维护分类、网站、RSS 地址、采集频率和启停状态。
2. 自动采集：支持手动触发和定时调度；优先 RSS/Atom，失败或无 RSS 时使用网页解析。
3. AI 摘要：通过 DashScope/Qwen 生成标题优化、简要总结、关键要点、标签。
4. 阅读闭环：信息看板分页阅读、文章详情抽屉、收藏/取消收藏、我的收藏页继续读。
5. 用户数据隔离：所有核心资源按 `userId` 隔离，用户只能看到自己添加的网站和采集文章。

### 技术栈

| 层级 | 技术 |
|---|---|
| 后端 | Spring Boot 3.3.5, Java 17, Maven |
| 数据 | PostgreSQL, Flyway, Redis |
| 采集 | Rome RSS, Jsoup HTML |
| 认证 | Spring Security, jjwt |
| LLM | DashScope compatible API / Qwen |
| 前端 | Vue 3, TypeScript, Vite, Pinia, Vue Router |
| 部署 | Docker Compose |

---

## 2. 目录与关键文件

```text
D:\ProjectStudy\FrontierScan\
├── backend/
│   ├── pom.xml
│   └── src/main/
│       ├── java/com/frontierscan/
│       │   ├── auth/                 # 登录、用户、默认管理员初始化
│       │   ├── category/             # 分类 CRUD
│       │   ├── site/                 # 网站 CRUD
│       │   ├── article/              # 文章、收藏、收藏文章视图
│       │   ├── article/              # 文章、收藏、收藏文章视图、筛选查询
│       │   ├── collection/           # 采集器、调度器、任务记录、标签异步评估
│       │   ├── llm/                  # LLM Provider 抽象、DashScope 实现、摘要 Map-Reduce、标签系统
│       │   ├── llm/tag/             # 多领域标签系统（TagEvaluationAgent、领域分类、标签评分）
│       │   ├── llm/prompt_template/ # 提示词模板（domain-classifier.stg, tag-scorer.stg）
│       │   └── common/               # 响应、异常、安全、异步配置
│       └── resources/
│           ├── application.yml
│           ├── db/migration/
│           │   ├── V1__initial_schema.sql
│           │   ├── V2__seed_default_admin.sql
│           │   ├── V3__add_schema_comments.sql
│           │   ├── V4__create_tag_system.sql  # tag_domains + tech_tags + article_tags
│           │   ├── V5__add_collection_reliability.sql
│           │   ├── V6__extend_collection_reliability.sql
│           │   ├── V7__add_article_summary_governance.sql
│           │   ├── V8__backfill_article_summary_status.sql
│           │   ├── V9__add_article_full_content.sql
│           │   └── V10__make_article_source_hash_global_unique.sql
│           └── prompt_template/article-zh-llm-summary-prompt.stg
├── frontend/
│   └── src/
│       ├── api/                      # Axios API 封装
│       │   ├── articles.ts           # 文章 API（含筛选参数）
│       │   ├── tags.ts              # 标签系统 API（listDomains, listTags）
│       ├── layouts/AppLayout.vue
│       ├── router/index.ts
│       ├── stores/auth.ts
│       ├── types.ts
│       ├── components/
│       │   └── ArticleFilterBar.vue  # 文章筛选栏（关键词+标签+日期范围）
│       └── views/
│           ├── DashboardView.vue     # 信息看板：分页、详情抽屉、收藏、筛选
│           ├── FavoritesView.vue     # 我的收藏：继续阅读、取消收藏、筛选
│           ├── CategoriesView.vue
│           ├── SitesView.vue
│           ├── CollectionRunsView.vue
│           └── LoginView.vue
├── docs/
│   ├── AI-handover.md
│   ├── architecture.md
│   ├── local-development.md
│   └── 网页数据采集方案-初版.md
└── docker-compose.yml
```

### 迁移文件重要约定

当前最新迁移文件是 `V10__make_article_source_hash_global_unique.sql`（V10：基于规范化 URL 的 sourceHash 全局唯一约束），后续迁移继续从 V11 递增。
注意：用户已明确修正过版本号，不要再创建或改回 V2/V3；新增迁移前必须先检查 `backend/src/main/resources/db/migration` 的真实最新版本。

---

## 3. 后端当前实现

### 3.1 模块职责

| 模块 | 说明 |
|---|---|
| `auth` | 用户登录、JWT 签发、当前用户信息、默认管理员种子 |
| `category` | 分类增删改查、归档、排序，全部按用户隔离 |
| `site` | 网站增删改查、按分类筛选、采集频率配置，创建/更新时校验分类归属 |
| `article` | 文章分页、详情、统计、收藏/取消收藏、收藏文章视图 |
| `collection` | RSS/HTML 采集、定时调度、任务记录、Redis 锁、异步执行 |
| `llm` | 大模型摘要抽象、DashScope Provider、提示词模板 |
| `common` | 统一响应、统一异常、安全过滤器、异步线程池 |

### 3.2 文章与收藏

文章模块已经完成阅读闭环所需能力：

- `GET /api/articles`：分页查询，支持 categoryId、siteId、keyword、tagId、startDate/endDate 筛选。
- 信息看板使用 `ArticleRepository.findWithFilters()`（原生 SQL + cast() 确保类型安全）。
- 收藏页使用 `ArticleService.listFavoriteArticlesWithFilters()`（内存过滤避免 JPQL 参数问题）。
- `GET /api/articles/{id}`：查询文章详情，Service 层校验文章归属。
- `GET /api/articles/favorites`：返回收藏文章视图，而不是只返回收藏关系。
- `POST /api/articles/{id}/favorite`：切换收藏状态。
- `DELETE /api/articles/{id}/favorite`：取消收藏。
- `GET /api/articles/count`：返回总文章数和今日采集数。

`FavoriteArticleView` 返回字段：

```text
favoriteId, articleId, title, summary, keyPoints, tags,
sourceUrl, publishedAt, collectedAt, favoritedAt
```

注意事项：

- 收藏列表查询同时过滤 `Favorite.userId` 和 `Article.userId`，防止历史脏数据导致跨用户文章泄露。
- `ArticleService.toggleFavorite()` 和 `ArticleService.removeFavorite()` 已加 `@Transactional`，否则派生删除查询会因缺少事务失败。
- `removeFavorite()` 是幂等设计，便于前端卡片和详情抽屉共用星标取消收藏。

### 3.3 采集链路

手动采集入口：

```text
POST /api/collection-runs/sites/{siteId}
```

执行流程：

```text
Controller 校验 siteId 属于当前用户
  -> 创建 RUNNING CollectionRun，立即返回 202 + runId
  -> CollectionOrchestrator 异步执行
  -> RSS 优先，失败时降级 HTML
  -> ArticleService.batchSaveArticles() 按全局 sourceHash 去重落库
  -> LLM 并发摘要（失败仅记录 warningMessage，不阻断采集成功）
  -> updateLlmSummary() 写回 summary/keyPoints/tags/title
  -> CollectionRun 标记 COMPLETED 或 FAILED，并同步站点健康状态
```

定时采集入口：

```text
CollectionScheduler @Scheduled
```

关键规则：

- 通过 `app.collection.scheduler-enabled` 控制定时任务开关。
- 通过 `app.collection.scheduler-fixed-delay-ms` 控制扫描间隔，默认 10 秒。
- 站点到期逻辑为：最近一次采集开始时间 + `site.collectionIntervalMinutes` <= 当前时间。
- `collection_runs` 中已有同站点 `RUNNING` 任务时跳过，避免重复采集。
- Redis 可用时使用 `frontierscan:collection:site:{siteId}` 站点级锁；Redis 不可用时降级为数据库 RUNNING 状态防重。
- 定时调度会先扫描到期失败任务并创建 `SCHEDULED_RETRY`，再扫描普通到期站点。
- 自动重试最多 3 次，退避间隔为 5 / 15 / 60 分钟；超过最大次数后 `nextRetryAt = null`，不再自动重试。
- 即使 `collectedCount = 0`，只要采集链路正常完成，也代表一次成功采集尝试，会影响下一次到期时间。

去重规则：

- `ArticleParser.generateSourceHash()` 会先调用 `normalizeSourceUrl()` 规范化 URL，再对规范化结果做 SHA-256。
- 规范化会移除 fragment、`utm_*`、`fbclid`、`gclid`、`spm` 等常见追踪参数，统一 host 大小写、`www.`、默认端口、末尾斜杠，并排序保留的业务参数。
- `HtmlCollector` 优先使用文章页 `link[rel=canonical]`，其次使用 `meta[property=og:url]`，再回退到实际抓取 URL，降低 RSS 与 HTML 链路 URL 形态不同造成的重复。
- `ArticleService.batchSaveArticles()` 使用全局 `existsBySourceHash()` 查重；V10 将 `articles.source_hash` 提升为全局唯一。
- 当前模型是“同一 sourceHash 全局只保存一篇文章”。如果未来要支持多用户都看到同一篇文章但底层内容只存一份，需要拆分为全局文章表 + 用户文章关系表。

### 3.4 采集可靠性增强一期

本轮已完成采集可靠性增强一期，核心文件：

```text
backend/src/main/java/com/frontierscan/collection/CollectionFailureClassifier.java
backend/src/main/java/com/frontierscan/collection/CollectionRunService.java
backend/src/main/java/com/frontierscan/collection/CollectionScheduler.java
backend/src/main/java/com/frontierscan/collection/CollectionOrchestrator.java
backend/src/main/java/com/frontierscan/site/SiteService.java
backend/src/main/resources/db/migration/V6__extend_collection_reliability.sql
```

数据库字段：

- `sites.consecutive_failures`、`last_failure_reason`、`last_failure_at`：V5 已增加，用于站点连续失败追踪。
- `sites.last_success_at`、`sites.next_retry_at`：V6 增加，用于展示最近成功和下一次自动重试时间。
- `collection_runs.retry_count`：V5 已增加，V6 后实体已映射。
- `collection_runs.failure_type`、`failure_stage`、`next_retry_at`、`retry_of_run_id`、`warning_message`：V6 增加，用于失败分类、重试审计和非阻断告警。

失败分类口径：

```text
NETWORK_TIMEOUT
RSS_PARSE_ERROR
HTML_PARSE_ERROR
EMPTY_RESULT
LLM_SUMMARY_FAILED
UNKNOWN
```

关键业务规则：

- RSS 失败会先降级 HTML；只有最终失败才写站点失败状态。
- 采集器解析出候选文章但去重后新增 0 篇，视为成功采集。
- 采集器无法解析出任何候选文章，视为 `EMPTY_RESULT` 失败并进入重试。
- 成功采集会写入 `sites.last_success_at`，清空连续失败、最后失败原因和 `next_retry_at`。
- 失败采集会写入 `collection_runs.failure_type/failure_stage/error_message/next_retry_at`，并同步站点健康状态。
- LLM 摘要失败写入 `collection_runs.warning_message`，任务仍为 `COMPLETED`，不增加站点连续失败次数。
- 手动重试创建 `MANUAL_RETRY` 新任务；创建成功后才清理原失败任务 `nextRetryAt` 和站点失败状态，避免“重试未提交但状态被清空”。
- 自动重试创建 `SCHEDULED_RETRY` 新任务，并通过 `retry_of_run_id` 关联原失败任务。

### 3.5 发布时间与正文处理

近期已增强发布时间提取：

- `ArticleParser.extractPublishedDate()` 支持 meta、time 标签、常见中文日期文本，例如 `日期：2026年6月5日`。
- `RssCollector` 在 RSS `pubDate` 缺失时，会尝试从内容 HTML 中提取发布时间。
- 已有历史文章如果 `publishedAt = null`，不会自动回填，除非后续新增回填任务。

正文展示策略：

- 原文正文不再在详情抽屉展示，用户需要完整原文时点击原文链接。
- 前端主要展示 LLM 摘要、关键要点、标签、发布时间、采集时间和原文链接。

---

## 4. 前端当前实现

### 4.1 路由

```text
/login              登录页
/dashboard          信息看板
/favorites          我的收藏
/categories         分类管理
/sites              网站管理
/collection-runs    任务记录
```

受保护路由统一在 `AppLayout.vue` 内渲染，侧边栏包含：信息看板、我的收藏、分类管理、网站管理、任务记录。

### 4.2 信息看板

`DashboardView.vue` 当前能力：

- 顶部统计：分类数、网站数、今日采集数、总文章数。
- 最新文章分页：默认每页 10 条，用户可切换 10/20/50。
- 文章卡片：
  - 统一卡片结构。
  - 标题右侧支持红色小号 `new` 标志。
  - `new` 判断口径：按 `collectedAt`，采集后 12 小时内显示。
  - 元信息只显示原文发布时间。
  - 标签以浅色胶囊形式展示。
  - 摘要显示 `summary`，原文链接跳转 `sourceUrl`。
  - 五角星按钮支持点击收藏/取消收藏，高亮表示已收藏。
- 详情抽屉：
  - 展示标题、发布时间、采集时间、摘要、关键要点、标签、原文链接。
  - 星标按钮与列表同步收藏状态。

### 4.3 我的收藏

`FavoritesView.vue` 当前能力：

- 调用 `GET /api/articles/favorites` 直接拿收藏文章视图，避免逐条请求文章详情。
- 收藏文章卡片样式与信息看板统一。
- 收藏页卡片展示：
  - 标题 + 12 小时内 `new` 标志。
  - 标签胶囊。
  - 收藏时间 `favoritedAt`。
  - 原文发布时间 `publishedAt`，为空显示 `-`。
  - 摘要、查看原文、星标取消收藏。
- 点击卡片打开文章详情抽屉。
- 点击星标取消收藏后，从当前列表移除；若在详情抽屉内取消收藏，则关闭抽屉。

### 4.4 前端类型/API

核心类型在 `frontend/src/types.ts`：

- `Article`
- `FavoriteArticle`
- `Page<T>`
- `ApiResponse<T>`

文章 API 在 `frontend/src/api/articles.ts`：

```text
list(params)
get(id)
toggleFavorite(id)
removeFavorite(id)
favorites()
count()
```

所有 API 通过 `apiClient` 自动携带 JWT。

### 4.5 文章筛选栏组件

`ArticleFilterBar.vue` 是共享筛选组件，注入到信息看板和收藏页：

- 关键词搜索：300ms 防抖，自动触发刷新。
- 标签下拉：从 `GET /api/tags/domains` 加载全领域标签，合并去重后平铺展示。
- 日期范围：两个原生 `<input type="date">`，选择后即时触发。
- 事件机制：`@filter-change` emit 筛选条件变更，父组件重置到第 1 页并重新请求。

### 4.6 网站管理与任务记录增强

`SitesView.vue` 当前已展示站点采集健康状态：

- 连续失败次数。
- 最近成功时间 `lastSuccessAt`。
- 最近失败时间 `lastFailureAt`。
- 最近失败原因 `lastFailureReason`。
- 下次自动重试时间 `nextRetryAt`。
- 网站抽屉中展示完整失败原因和最近成功信息。

`CollectionRunsView.vue` 当前已增强任务排障能力：

- 展示任务类型：手动、定时、手动重试、自动重试。
- 展示失败类型 `failureType` 和失败阶段 `failureStage`。
- 展示重试次数 `retryCount`、下次重试时间 `nextRetryAt`。
- 展示错误信息 `errorMessage` 或非阻断告警 `warningMessage`。
- 失败任务支持“重试”；任意带站点的历史任务支持“重新采集”。

---

## 5. 用户数据隔离

当前隔离策略是后端强制，不依赖前端传参：

- Controller 通过 `@AuthenticationPrincipal JwtPrincipal` 获取当前用户。
- Service/Repository 查询均绑定 `userId`。
- 分类、网站、文章详情、收藏、取消收藏、采集触发均校验资源归属。
- 创建/更新网站时会校验 `categoryId` 是否属于当前用户。
- 收藏列表查询会同时校验收藏关系和文章本体的 `userId`。
- 资源不存在或不属于当前用户统一返回 404，避免通过 ID 探测其他用户数据。

对应测试：

```text
backend/src/test/java/com/frontierscan/security/UserDataIsolationIntegrationTest.java
```

该测试覆盖分类、网站、文章、收藏的隔离场景，以及收藏文章视图不会泄露跨用户脏数据。

---

## 6. API 清单

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/auth/login` | 登录获取 JWT |
| POST | `/api/auth/me` | 当前用户信息 |
| GET | `/api/ping` | 心跳 |
| GET | `/api/categories` | 分类列表 |
| GET | `/api/categories/{id}` | 分类详情 |
| POST | `/api/categories` | 创建分类 |
| PUT | `/api/categories/{id}` | 更新分类 |
| DELETE | `/api/categories/{id}` | 删除分类 |
| GET | `/api/sites` | 网站列表，可按 `categoryId` 筛选 |
| GET | `/api/sites/{id}` | 网站详情 |
| POST | `/api/sites` | 创建网站 |
| PUT | `/api/sites/{id}` | 更新网站 |
| DELETE | `/api/sites/{id}` | 删除网站 |
| GET | `/api/articles` | 文章分页列表，支持 `page`、`size`、`categoryId`、`siteId` |
| GET | `/api/articles/{id}` | 文章详情 |
| GET | `/api/articles/favorites` | 当前用户收藏文章视图列表 |
| POST | `/api/articles/{id}/favorite` | 切换收藏 |
| DELETE | `/api/articles/{id}/favorite` | 取消收藏 |
| GET | `/api/articles/count` | 文章总数与今日采集数 |
| GET | `/api/collection-runs` | 采集任务历史 |
| GET | `/api/collection-runs/{runId}` | 单个采集任务详情 |
| POST | `/api/collection-runs/{runId}/retry` | 重试失败采集任务，创建 `MANUAL_RETRY` 新任务 |
| POST | `/api/collection-runs/sites/{siteId}` | 手动触发站点采集，返回 202 |
| GET | `/api/tags/domains` | 返回全部领域及其标签列表 |
| GET | `/api/tags/domains/{domainName}` | 返回指定领域的所有标签 |
| GET | `/actuator/health` | 健康检查 |

---

## 7. 配置与运行

### 7.1 后端配置

主要配置在 `backend/src/main/resources/application.yml`：

```yaml
spring:
  datasource:
    url: ${SPRING_DATASOURCE_URL:jdbc:postgresql://localhost:5432/frontierscan}
  flyway:
    enabled: true
    repair-on-migrate: true
  jpa:
    hibernate:
      ddl-auto: validate

app:
  security:
    jwt-secret: ${JWT_SECRET:please-change-this-secret-to-a-long-random-value}
    jwt-expires-in-seconds: ${JWT_EXPIRES_IN_SECONDS:86400}
  llm:
    provider: ${LLM_PROVIDER:dashscope}
    base-url: ${LLM_BASE_URL:https://dashscope.aliyuncs.com/compatible-mode/v1}
    api-key: ${DASHSCOPE_API_KEY:${LLM_API_KEY:}}
    model: ${LLM_MODEL:qwen-plus}
  collection:
    scheduler-enabled: ${COLLECTION_SCHEDULER_ENABLED:true}
    scheduler-fixed-delay-ms: ${COLLECTION_SCHEDULER_FIXED_DELAY_MS:10000}
    lock-ttl-minutes: ${COLLECTION_LOCK_TTL_MINUTES:5}
```

### 7.2 常用命令

后端测试：

```powershell
Set-Location D:\ProjectStudy\FrontierScan\backend
mvn test -q
```

前端构建：

```powershell
Set-Location D:\ProjectStudy\FrontierScan\frontend
npm run build
```

注意：当前环境里 PowerShell 有时会把 JVM warning 当成 `NativeCommandError`，即使 Surefire 报告显示测试通过。遇到这种情况以 `backend\target\surefire-reports` 中的 `Failures: 0, Errors: 0` 为准。

---

## 8. 测试现状

后端测试覆盖：

| 测试文件 | 覆盖内容 |
|---|---|
| `ArticleParserTest` | 正文清洗、正文提取、发布时间提取、sourceHash |
| `RssCollectorTest` | RSS 正常采集、异常处理、发布时间兜底 |
| `CollectionOrchestratorIntegrationTest` | 手动采集编排、去重、隔离、RSS/HTML 降级、空结果失败、LLM 告警 |
| `CollectionRunServiceTest` | 任务失败记录、手动重试、用户隔离、重试失败时保持原失败状态 |
| `CollectionSchedulerTest` | 到期判断、重复任务保护、Redis 锁、失败任务自动重试 |
| `CollectionSchedulerIntegrationTest` | 定时调度集成行为 |
| `UserDataIsolationIntegrationTest` | 分类/网站/文章/收藏隔离、收藏文章视图、取消收藏幂等 |

近期验证结果：

- 前端 `npm run build` 通过。
- 后端 Surefire 报告显示测试通过；最近一次完整测试为 55 个测试，`Failures: 0, Errors: 0`。
- 最近一次单独运行 `CollectionRunServiceTest` 时，被本地 `backend/target/classes/application.yml` 文件占用挡在 Maven resources 阶段，报“拒绝访问”；这是本地文件句柄/进程占用问题，不是测试断言失败。

---

## 9. 企业级注释约定

用户已明确要求：后续所有新增业务代码都需要补充规范注释，方便新人交接。

当前建议：

- Java 类、核心方法、Repository 自定义查询使用 Javadoc。
- 业务关键点必须解释“为什么这么做”，例如用户隔离、事务边界、脏数据防泄漏。
- Vue 页面顶部保留页面说明注释。
- `ref` 状态、复杂 computed、API 请求函数、格式化/拆分等辅助函数写简洁中文注释。
- 不要给显而易见的普通赋值写空洞注释。

---

## 10. 已知注意事项

1. 历史文章的 `publishedAt = null` 不会自动修复；如需补齐，需要新增回填任务。
2. 收藏页依赖 `GET /api/articles/favorites` 返回文章视图，前端不再逐条请求卡片数据。
3. 信息看板和收藏页的 `new` 标志按 `collectedAt` 判断，不按发布时间或收藏时间判断。
4. 前端卡片标签目前仍优先展示文章字符串标签；后端已存在结构化 `article_tags` 关系表，并已接入采集后的标签评分流水线。
5. 详情抽屉不展示原文正文，避免长正文撑开页面；用户通过原文链接查看全文。
6. Flyway 后续新增迁移从 V11 开始；V7/V8/V9/V10 都不要改历史文件，避免已执行环境出现 checksum mismatch。
7. 不要在未被用户要求时更新交接文档；本次更新是用户明确要求。

---

## 11. 下一步开发建议

建议优先级如下：

1. **阅读体验增强**
   - 收藏页分页。
   - 已读/未读状态。
   - 卡片按发布时间、采集时间、收藏时间排序切换。

2. **标签系统完善**
   - 在分类管理中添加领域标签扩展。
   - 更多领域种子数据。
   - 标签用于文章推荐和发现。
   - 前端卡片/详情逐步从字符串标签过渡到结构化标签关系展示。

3. **摘要治理二期**
   - 为摘要重试做异步任务化，避免超长文章同步等待影响交互。
   - 增加历史文章全文回填或重新抓取任务，降低旧数据只能依赖 `content_excerpt` 的比例。
   - 增加摘要/标签治理的可观测统计，如失败率、低质量率、平均耗时。

4. **账号体系完善**
   - 用户注册。
   - 修改密码。
   - 管理员用户管理。

---

## 12. 接手检查清单

新 AI 或工程师接手后建议先做：

1. 阅读 `docs/AI-handover.md`、`docs/local-development.md`、`docs/architecture.md`。
2. 查看 `git status --short`，确认是否有用户未提交改动。
3. 若要改数据库，先确认 `backend/src/main/resources/db/migration` 最新版本号，当前最新为 V10，后续从 V11 开始。
4. 若要改用户私有资源，先检查 Service 层是否绑定 `userId`。
5. 若要改前端文章卡片，确保信息看板和我的收藏样式一致。
6. 完成后至少运行：

```powershell
Set-Location D:\ProjectStudy\FrontierScan\frontend
npm run build
```

涉及后端时运行：

```powershell
Set-Location D:\ProjectStudy\FrontierScan\backend
mvn test -q
```

---

本文档由 Codex 维护。每次用户明确要求更新交接文档，或发生重大业务/接口/数据库变更时，再同步更新。
---

## 13. 2026-06-15 补充：LLM 摘要治理一期

本次已完成 LLM 摘要治理一期。注意：如果本文档上方仍出现“当前最新迁移为 V6”或“下一步进入 LLM 摘要治理”等旧描述，以第 14 节和当前迁移目录为准。

### 13.1 当前最新迁移版本

截至 2026-06-15，当时最新 Flyway 迁移为：

```text
V8__backfill_article_summary_status.sql
```

迁移说明：

- `V7__add_article_summary_governance.sql`：为 `articles` 表新增文章级摘要治理字段。
- `V8__backfill_article_summary_status.sql`：修复已经执行过 V7 的环境，将“已有 summary 但 summary_status 仍为 PENDING”的历史文章回填为 `COMPLETED`。
- 重要约定：**不要再修改 V7**。V7 已经在本地数据库执行过，修改会导致 Flyway checksum mismatch。
- 2026-07-01 已新增 V10，后续数据库变更从 V11 开始。

`articles` 新增字段：

```text
summary_status              摘要状态：PENDING / COMPLETED / FAILED / LOW_QUALITY
summary_quality_score       摘要质量规则评分，满分 100
summary_quality_reason      摘要失败或低质量原因
summary_retry_count         用户手动重新生成摘要次数
summary_last_attempt_at     最近一次尝试生成摘要时间
summary_updated_at          最近一次成功写入摘要时间
```

### 13.2 后端摘要治理实现

核心文件：

```text
backend/src/main/java/com/frontierscan/article/ArticleSummaryService.java
backend/src/main/java/com/frontierscan/article/ArticleSummaryStatus.java
backend/src/main/java/com/frontierscan/llm/SummaryQualityEvaluator.java
backend/src/main/java/com/frontierscan/llm/SummaryQualityResult.java
```

业务规则：

- 新文章入库时默认 `summary_status = PENDING`。
- 采集保存新文章后，由 `CollectionOrchestrator` 调用 `ArticleSummaryService.summarizeCollectedArticle()` 生成摘要。
- 摘要生成成功后先经过 `SummaryQualityEvaluator` 评分：
  - 分数大于等于 70：`COMPLETED`
  - 分数低于 70：`LOW_QUALITY`，仍保存摘要内容，方便用户先读再决定是否重试
- LLM 返回空、调用异常、正文片段为空：`FAILED`
- LLM 摘要失败不阻断采集任务，采集任务仍可 `COMPLETED`，并通过 `collection_runs.warning_message` 保留告警。

摘要质量判断规则：

- 硬性不合格：摘要为空、包含模板占位符、包含模型原始格式污染、疑似直接截断原文。
- 扣分项：过短、过长、句子数量不足、关键要点不足、标签为空、重复句子、无效兜底表达。

新增接口：

```text
POST /api/articles/{id}/summary/retry
```

接口说明：

- 当前用户只能重新生成自己的文章摘要。
- Service 层通过文章 `userId` 做隔离校验，文章不存在或不属于当前用户统一返回 404。
- 当前为同步生成并返回更新后的 `Article`；如果后续响应时间影响体验，再考虑异步任务化。

### 13.3 前端摘要治理展示

核心文件：

```text
frontend/src/views/DashboardView.vue
frontend/src/api/articles.ts
frontend/src/types.ts
```

文章详情抽屉新增展示：

- 摘要状态
- 摘要质量分
- 摘要失败或低质量原因
- 用户手动重试次数
- “重新生成摘要”按钮

“重新生成摘要”按钮只在文章详情抽屉出现。按钮出现并可用的条件：

- `summary` 为空；或
- `summaryStatus = FAILED`；或
- `summaryStatus = LOW_QUALITY`；或
- `summaryStatus = PENDING` 且没有 `summary`

按钮不会出现的情况：

- `summaryStatus = COMPLETED`
- `summaryStatus = PENDING` 但文章已有 `summary`

前端已做兼容兜底：如果历史脏数据出现 `PENDING + 有 summary`，详情抽屉显示为“摘要已生成”，不显示重新生成按钮，避免误导用户。

### 13.4 最近验证结果

已验证：

```powershell
Set-Location D:\ProjectStudy\FrontierScan\frontend
npm run build
```

结果：前端构建通过。

后端启动已验证：

```powershell
Set-Location D:\ProjectStudy\FrontierScan\backend
mvn spring-boot:run
```

结果：

- Flyway 成功校验 8 个迁移。
- 数据库从 version 7 成功迁移到 version 8。
- 后端成功启动。

注意：`mvn spring-boot:run` 启动成功后会持续运行，命令超时不代表启动失败；以日志中的 `Started FrontierScanApplication` 为准。

---

## 14. 2026-07-01 最新补充：全文摘要 Map-Reduce 与标签流水线

本次核对当前代码后，同步更新交接状态。当前项目已经走到 V10，且摘要治理已经从“片段摘要”扩展到“全文字段 + 长文 Map-Reduce + 摘要后标签评估流水线”，采集去重也已升级为规范化 URL sourceHash 全局去重。

### 14.1 当前最新迁移版本

当前最新 Flyway 迁移为：

```text
V10__make_article_source_hash_global_unique.sql
```

迁移说明：

- `V9__add_article_full_content.sql`：为 `articles` 表新增 `content_full` 字段。
- `V10__make_article_source_hash_global_unique.sql`：将 `articles.source_hash` 提升为全局唯一，用于跨用户、跨 RSS/HTML 链路去重。
- `content_excerpt` 继续承担列表展示和历史兜底职责。
- `content_full` 保存采集到的清洗后全文正文，用于 LLM 全文摘要 Map-Reduce 和标签语义兜底。
- 本期不重新抓取历史文章，因此 `content_full` 允许为空；历史文章重新摘要或标签评估时会回退到 `content_excerpt`。
- 重要约定：**后续数据库变更从 V11 开始**；V7/V8/V9/V10 都不要改历史迁移文件。

### 14.2 全文摘要 Map-Reduce

核心文件：

```text
backend/src/main/java/com/frontierscan/llm/SummaryMapReduceService.java
backend/src/main/java/com/frontierscan/llm/SummaryMapReduceException.java
backend/src/main/java/com/frontierscan/article/ArticleSummaryService.java
backend/src/main/java/com/frontierscan/article/Article.java
backend/src/main/java/com/frontierscan/collection/CollectResult.java
backend/src/main/java/com/frontierscan/collection/HtmlCollector.java
backend/src/main/java/com/frontierscan/collection/RssCollector.java
backend/src/main/java/com/frontierscan/common/config/AsyncConfig.java
```

关键规则：

- 新采集文章会同时保存 `content_excerpt` 和 `content_full`。
- 摘要输入优先使用 `content_full`；如果为空，则回退到 `content_excerpt`。
- `SummaryMapReduceService` 在正文过长且配置开启时，将正文按配置拆分为多个 chunk，先并发执行 map 摘要，再把分块摘要合并后执行 reduce 摘要。
- 任一分块摘要失败会抛出 `SummaryMapReduceException`，避免用不完整分块结果生成看似成功的最终摘要。
- `frontierScanLlmMapReduceExecutor` 只负责单篇长文内部的 map 分块并发；文章级摘要并发仍使用 `frontierScanLlmSummaryExecutor`。

相关配置在 `backend/src/main/resources/application.yml`：

```yaml
app:
  llm:
    summary-map-reduce:
      enabled: ${LLM_SUMMARY_MAP_REDUCE_ENABLED:true}
      chunk-size-chars: ${LLM_SUMMARY_CHUNK_SIZE_CHARS:6000}
      overlap-chars: ${LLM_SUMMARY_OVERLAP_CHARS:500}
      max-chunks: ${LLM_SUMMARY_MAX_CHUNKS:0}
    tag:
      max-content-chars: ${LLM_TAG_MAX_CONTENT_CHARS:8000}
```

### 14.3 标签评分采集流水线

当前标签评分已经接入采集增强链路，不再只是后续建议。

核心文件：

```text
backend/src/main/java/com/frontierscan/collection/CollectionOrchestrator.java
backend/src/main/java/com/frontierscan/collection/TagEvaluationAsyncService.java
backend/src/main/java/com/frontierscan/article/ArticleService.java
backend/src/main/java/com/frontierscan/llm/tag/TagEvaluationAgent.java
```

流水线规则：

- 采集器保存新文章后，`CollectionOrchestrator` 会对每篇文章执行“摘要治理 -> 标签评估”流水线。
- 单篇文章摘要尝试完成后立即触发标签评估，不等待整批文章全部摘要完成。
- 标签评估输入由“摘要 + 关键要点 + 正文兜底”拼接而成；正文兜底优先使用 `content_full`，并按 `app.llm.tag.max-content-chars` 截断。
- 标签评估失败属于非阻断增强失败，只写入 `collection_runs.warning_message`，不把采集任务标记为失败，也不增加站点连续失败次数。
- 手动重新生成摘要成功后，会同步重新评估该文章标签，保证结构化标签和最新摘要/标题一致。

### 14.4 当前测试覆盖补充

新增或当前已存在的关键测试：

```text
backend/src/test/java/com/frontierscan/llm/SummaryMapReduceServiceTest.java
backend/src/test/java/com/frontierscan/collection/TagEvaluationAsyncServiceTest.java
backend/src/test/java/com/frontierscan/llm/SummaryQualityEvaluatorTest.java
backend/src/test/java/com/frontierscan/article/ArticleSummaryServiceTest.java
backend/src/test/java/com/frontierscan/article/ArticleFilterIntegrationTest.java
```

### 14.5 最近验证结果

2026-07-01 本次核对时已执行：

```powershell
Set-Location D:\ProjectStudy\FrontierScan\backend
mvn compile -q
```

结果：后端编译通过。

本次未运行完整 `mvn test -q` 和前端 `npm run build`。如果后续改动涉及后端业务逻辑，建议运行完整后端测试；涉及前端时继续运行前端构建。

---

## 15. 2026-07-01 补充：分类业务企业级完善

本次已完成分类业务从“基础 CRUD”到“可用于真实管理和阅读入口”的增强。分类仍然是用户手动维护的信息源组织维度，不等同于 AI 标签；文章分类来自其来源网站的 `categoryId`，标签仍由 LLM/标签系统根据文章内容评估。

### 15.1 后端分类业务规则

核心文件：

```text
backend/src/main/java/com/frontierscan/category/CategoryService.java
backend/src/main/java/com/frontierscan/category/CategoryController.java
backend/src/main/java/com/frontierscan/category/CategoryView.java
backend/src/main/java/com/frontierscan/category/CategoryRepository.java
backend/src/main/java/com/frontierscan/common/error/BusinessRuleException.java
backend/src/main/java/com/frontierscan/common/error/GlobalExceptionHandler.java
backend/src/main/java/com/frontierscan/site/SiteRepository.java
backend/src/main/java/com/frontierscan/article/ArticleRepository.java
backend/src/test/java/com/frontierscan/category/CategoryServiceTest.java
```

当前规则：

- 创建/更新分类时会 trim 分类名称和描述。
- 同一用户下分类名称不允许重复，忽略大小写；跨用户仍可使用同名分类。
- 分类名称不能为空，且不能超过 120 个字符。
- 删除分类前会检查是否已有网站或文章引用；如存在引用，返回业务冲突，提示先归档或迁移关联数据。
- 新增 `BusinessRuleException`，由全局异常处理器统一映射为 HTTP 409。
- `GET /api/categories` 和 `GET /api/categories/{id}` 返回 `CategoryView`，在原分类字段基础上增加 `siteCount`、`articleCount`，用于管理页和看板展示。

### 15.2 前端分类管理体验

核心文件：

```text
frontend/src/views/CategoriesView.vue
frontend/src/views/DashboardView.vue
frontend/src/views/SitesView.vue
frontend/src/types.ts
```

当前交互：

- 分类管理页主界面只展示列表、归档筛选和操作入口，保持页面干净。
- “新增分类”和“编辑分类”均通过弹窗完成，不再把表单常驻在页面上。
- 长描述、创建时间、更新时间、排序、状态、网站数、文章数通过“详情”按钮打开详情弹窗查看。
- 分类列表展示网站数和文章数；已有引用的分类禁用删除，避免用户触发后端外键或业务冲突。
- 看板 `DashboardView.vue` 已增加分类筛选条，点击分类后通过 `categoryId` 查询文章，使分类成为阅读入口。
- 网站管理 `SitesView.vue` 的分类下拉默认只展示未归档分类；编辑已有站点时，如果当前分类已归档，仍保留当前分类可见，避免表单状态失真。

### 15.3 验证结果

已执行：

```powershell
Set-Location D:\ProjectStudy\FrontierScan\backend
mvn compile -q

Set-Location D:\ProjectStudy\FrontierScan\backend
mvn -q -Dtest=CategoryServiceTest test

Set-Location D:\ProjectStudy\FrontierScan\frontend
npm run build
```

结果：

- 后端编译通过。
- `CategoryServiceTest` 共 5 个测试通过，`Failures: 0, Errors: 0`。
- 完整后端 Surefire 报告未发现失败或错误。
- 前端 `npm run build` 通过。

注意：当前 PowerShell 环境有时会把 JVM warning 当成 `NativeCommandError` 输出；遇到这种情况以 `backend/target/surefire-reports` 中的 `Failures: 0, Errors: 0` 为准。

### 15.4 后续建议

- 如后续要支持“分类下批量迁移网站/文章”，应新增明确迁移接口，不建议通过直接改库处理。
- 如后续要把 AI 标签和用户分类联动，应设计独立映射规则，例如“标签推荐分类”或“分类默认标签范围”，不要把分类直接替换为标签。
- 若继续改分类相关前端，保持当前约定：列表页轻量展示，新增/编辑走弹窗，长文本和审计信息进详情弹窗。

### 15.5 浏览器实测与移动端布局补充

2026-07-01 已通过本机 Chrome 远程调试访问正在运行的本地项目：

```text
http://localhost:5173
```

实测结论：

- 登录页、信息看板、分类管理、网站管理均可正常访问。
- 登录、分类列表、站点列表、文章列表等已观察到的接口返回 200，未发现新的前端控制台错误或请求失败。
- 分类管理的“新增分类”“编辑分类”“详情”均为弹窗交互，未出现表单常驻主页面的问题。
- 网站管理的“新增网站”“编辑网站”也为右侧子窗口/抽屉式交互，符合“点击按钮后再设置”的交互要求。

本次前端补充修复：

- `frontend/src/views/CategoriesView.vue` 为分类表格单元格补充 `data-label`。
- 在 `max-width: 760px` 下将分类表格视觉转换为字段卡片，解决移动端文字和操作按钮被压成竖排的问题。
- 移动端分类操作按钮改为 2 列布局，分类名称、排序、使用情况、状态、操作均可读。
- 桌面端仍保持原表格布局，未改变分类业务逻辑或接口。

已重新执行：

```powershell
Set-Location D:\ProjectStudy\FrontierScan\frontend
npm run build
```

结果：前端构建通过。浏览器测试产生的临时 Chrome profile 目录 `.tmp-chrome-profile/` 已清理，不应出现在后续提交中。
