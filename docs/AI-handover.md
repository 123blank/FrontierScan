# FrontierScan Agent - AI 交接文档

> 本文档目标：让零上下文的新 AI 或工程师在阅读后，能够理解项目现状、关键约定、已完成业务、验证方式和下一步开发方向。
>
> 最后更新：2026-06-15  
> 项目版本：0.1.0-SNAPSHOT  
> 当前重点：采集可靠性增强一期已完成（失败分类、站点健康状态、手动/自动重试、任务记录增强）。后续建议进入 LLM 摘要治理、标签评分接入采集管线和阅读体验增强。

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
│       │   ├── collection/           # 采集器、调度器、任务记录
│       │   ├── llm/                  # LLM Provider 抽象、DashScope 实现、标签系统
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
│           │   └── V6__extend_collection_reliability.sql
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

当前最新迁移文件是 `V6__extend_collection_reliability.sql`（V6：采集可靠性增强扩展），后续迁移继续从 V7 递增。
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
  -> ArticleService.batchSaveArticles() 按 userId + sourceHash 去重落库
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
4. 前端卡片标签目前从逗号/中文逗号拆分，后端存储仍是字符串，不是独立标签表。
5. 详情抽屉不展示原文正文，避免长正文撑开页面；用户通过原文链接查看全文。
6. Flyway 后续新增迁移从 V7 开始。
7. 不要在未被用户要求时更新交接文档；本次更新是用户明确要求。

---

## 11. 下一步开发建议

建议优先级如下：

1. **LLM 摘要治理**
   - 对摘要为空或 LLM 调用失败的文章提供重试摘要功能。
   - 给 `SummaryResult` 增加更严格的解析/兜底策略。
   - 接入 TagEvaluationAgent 到采集管线（两阶段标签评分：领域分类→标签评分）。

2. **阅读体验增强**
   - 收藏页分页。
   - 已读/未读状态。
   - 卡片按发布时间、采集时间、收藏时间排序切换。

3. **标签系统完善**
   - 在分类管理中添加领域标签扩展。
   - 更多领域种子数据。
   - 标签用于文章推荐和发现。

4. **账号体系完善**
   - 用户注册。
   - 修改密码。
   - 管理员用户管理。

---

## 12. 接手检查清单

新 AI 或工程师接手后建议先做：

1. 阅读 `docs/AI-handover.md`、`docs/local-development.md`、`docs/architecture.md`。
2. 查看 `git status --short`，确认是否有用户未提交改动。
3. 若要改数据库，先确认 `backend/src/main/resources/db/migration` 最新版本号，当前最新为 V6。
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

## 13. 2026-06-15 最新补充：LLM 摘要治理一期

本次已完成 LLM 摘要治理一期。注意：如果本文档上方仍出现“当前最新迁移为 V6”或“下一步进入 LLM 摘要治理”等旧描述，以本节为准。

### 13.1 当前最新迁移版本

当前最新 Flyway 迁移为：

```text
V8__backfill_article_summary_status.sql
```

迁移说明：

- `V7__add_article_summary_governance.sql`：为 `articles` 表新增文章级摘要治理字段。
- `V8__backfill_article_summary_status.sql`：修复已经执行过 V7 的环境，将“已有 summary 但 summary_status 仍为 PENDING”的历史文章回填为 `COMPLETED`。
- 重要约定：**不要再修改 V7**。V7 已经在本地数据库执行过，修改会导致 Flyway checksum mismatch。后续数据库变更从 V9 开始。

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
