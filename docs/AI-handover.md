# FrontierScan Agent — AI 交接文档

> **本文档目标**：让零上下文的新 AI 在阅读后，能够完全理解项目全貌，无缝接手继续业务开发。
> 最后更新：2026-06-11 | 项目版本：0.1.0-SNAPSHOT

---

## 1. 项目概述

### 一句话

FrontierScan 是一个**企业级 Web Agent 系统**，用于自动采集技术/AI 前沿网站信息，通过大模型进行摘要处理，并按分类以卡片形式展示。

### 核心能力

1. **信息源管理** — 用户自定义分类和网站（支持 RSS/Atom + 网页解析）
2. **自动采集** — 手动触发 + 定时调度，优先 RSS 解析、降级到网页抓取，**已实现完整链路**
3. **AI 摘要** — 阿里 DashScope/Qwen 大模型生成摘要、要点、标签（已接入真实 DashScope API + 外置提示词模板）
4. **阅读助手** — 分屏索引、搜索、收藏、按分类/来源/时间筛选
5. **用户隔离** — JWT 认证，每个用户只能看到自己的数据

### 技术栈

| 层级 | 技术 | 版本 |
|---|---|---|
| 后端框架 | Spring Boot | 3.3.5 |
| JDK | Java | 17 |
| 构建工具 | Maven | 3.9.9 |
| 代码简化 | **Lombok** | 1.18.34 |
| RSS 解析 | **Rome** | 2.1.0 |
| HTML 解析 | **Jsoup** | 1.18.1 |
| 认证 | **jjwt** | 0.12.6 |
| 前端框架 | Vue 3 | 3.5.12 |
| 语言 | TypeScript | 5.6.3 |
| 构建 | Vite | 4.5.5 |
| 状态管理 | Pinia | 2.2.4 |
| 数据库 | PostgreSQL | 16 (Docker) |
| 缓存 | Redis | 7 (Docker) | (Docker) |
| 部署 | Docker Compose | 1 文件启动 |
| 大模型 | DashScope / Qwen | 已接入真实 API |

---

## 2. 目录结构

```
D:\ProjectStudy\FrontierScan\
├── backend/                          # Spring Boot 后端
│   ├── pom.xml                       # Maven 依赖管理
│   ├── Dockerfile                    # 多阶段构建
│   └── src/
│       ├── main/java/com/frontierscan/
│       │   ├── FrontierScanApplication.java   # 启动入口
│       │   ├── auth/                 # 认证模块
│       │   ├── category/             # 分类模块
│       │   ├── site/                 # 网站模块
│       │   ├── article/              # 文章模块
│       │   ├── collection/           # 采集任务模块 ★ 核心
│       │   │   ├── Collector.java           # 策略接口
│       │   │   ├── CollectResult.java       # 采集结果 record
│       │   │   ├── ArticleParser.java       # 正文/日期提取工具
│       │   │   ├── RssCollector.java        # RSS/Atom 采集器
│       │   │   ├── HtmlCollector.java       # 网页抓取采集器
│       │   │   ├── CollectionOrchestrator.java  # 采集编排器
│       │   │   ├── CollectorException.java      # 异常基类
│       │   │   ├── ConnectionTimeoutException.java
│       │   │   ├── ParseException.java
│       │   │   └── EmptyResultException.java
│       │   ├── llm/                  # 大模型抽象层
│       │   └── common/               # 公共基础设施
│       │       ├── api/              # 统一响应 + Ping 端点
│       │       ├── config/           # Security + Async + 初始化
│       │       ├── error/            # 全局异常处理
│       │       └── security/         # JWT 工具 + 过滤器
│       ├── main/resources/
│       │   ├── application.yml
│       │   ├── prompt_template/
│       │   │   └── article-zh-llm-summary-prompt.stg       # 主配置（环境变量覆盖）
│       │   └── db/migration/         # Flyway 迁移
│       └── test/                     # 测试代码
│           ├── java/.../collection/
│           │   ├── ArticleParserTest.java
│           │   ├── RssCollectorTest.java
│           │   └── CollectionOrchestratorIntegrationTest.java
│           └── resources/
│               ├── application-test.yml    # H2 测试配置
│               ├── test-rss.xml            # RSS 夹具
│               ├── test-article.html       # HTML 夹具
│               └── test-article-no-date.html
├── frontend/                         # Vue 3 前端
│   ├── package.json
│   ├── vite.config.ts
│   ├── index.html
│   ├── Dockerfile
│   ├── nginx.conf
│   └── src/
│       ├── main.ts                   # 应用入口
│       ├── App.vue                   # 根组件
│       ├── types.ts                  # 全局类型定义
│       ├── api/                      # API 服务层
│       │   ├── client.ts             # Axios 实例 + JWT 拦截器
│       │   ├── categories.ts
│       │   ├── sites.ts
│       │   ├── articles.ts
│       │   └── collectionRuns.ts
│       ├── stores/
│       │   └── auth.ts               # Pinia 认证状态
│       ├── router/
│       │   └── index.ts              # Vue Router + 鉴权守卫
│       ├── layouts/
│       │   └── AppLayout.vue         # 主导航布局
│       ├── views/
│       │   ├── LoginView.vue         # 登录页
│       │   ├── DashboardView.vue     # 信息看板
│       │   ├── CategoriesView.vue    # 分类管理
│       │   ├── SitesView.vue         # 网站管理
│       │   └── CollectionRunsView.vue # 任务记录
│       └── styles/
│           └── main.css              # 全局样式
├── docs/
│   ├── architecture.md               # 架构说明（中文）
│   ├── local-development.md          # 本地开发指南（中文）
│   ├── AI-handover.md                # ← 本文档
│   ├── 网页数据采集方案-初版.md       # 采集方案设计文档
│   └── 采集链路测试指南.md            # 测试流程与用例
├── docker-compose.yml                # 单机部署编排
├── .env.example                      # 环境变量模板
└── README.md                         # 项目自述（中文）
```

---

## 3. 后端模块详解

### 3.1 模块依赖关系图

```
FrontierScanApplication
├── auth (认证)
│   ├── UserAccount           ← 实体: app_users 表
│   ├── AuthController        ← POST /api/auth/login, POST /api/auth/me
│   ├── AuthService           ← 登录验证 + 默认 admin 初始化
│   └── UserAccountRepository ← JPA 接口
│
├── category (分类)
│   ├── Category              ← 实体: categories 表
│   ├── CategoryController    ← 完整 CRUD
│   ├── CategoryService       ← 业务逻辑
│   └── CategoryRepository    ← JPA 接口(按用户查询)
│
├── site (网站)
│   ├── Site                  ← 实体: sites 表
│   ├── SiteController        ← 完整 CRUD + 按分类筛选
│   ├── SiteService           ← 业务逻辑
│   └── SiteRepository        ← JPA 接口
│
├── article (文章)
│   ├── Article               ← 实体: articles 表
│   ├── Favorite              ← 实体: favorites 表
│   ├── ArticleController     ← 分页查询 / 详情 / 收藏
│   ├── ArticleService        ← 业务逻辑 + 去重 + batchSave
│   ├── ArticleRepository     ← JPA 接口(多维分页)
│   └── FavoriteRepository    ← JPA 接口
│
├── collection (采集任务) ★ 核心模块
│   ├── Collector             ← 策略接口: 采集器抽象
│   ├── CollectResult         ← 采集结果 record (含 RawArticle)
│   ├── ArticleParser         ← 正文提取 / 日期提取 / SHA-256 哈希
│   ├── RssCollector          ← RSS/Atom 采集器（Rome）
│   ├── HtmlCollector         ← 网页抓取采集器（Jsoup，含同域名过滤）
│   ├── CollectionOrchestrator ← 采集编排器（异步执行 + RSS→HTML 自动降级）
│   ├── CollectionRun         ← 实体: collection_runs 表
│   ├── CollectionRunController ← 202 Accepted 异步触发
│   ├── CollectionRunService  ← 状态机(RUNNING→COMPLETED/FAILED)
│   ├── CollectionRunRepository ← JPA 接口
│   └── 异常体系 (CollectorException / ConnectionTimeoutException / ParseException / EmptyResultException)
│
├── llm (大模型)
│   ├── LlmProvider           ← 接口: 摘要抽象
│   ├── DashScopeLlmProvider  ← DashScope 实现（RestTemplate + 外置模板）
│   ├── LlmProperties         ← 配置类(app.llm.*)
│   ├── SummaryRequest        ← 请求体 record
│   └── SummaryResult         ← 响应体 record
│
└── common (公共)
    ├── api/
    │   ├── ApiResponse<T>    ← 统一响应 record {success, data, message, timestamp}
    │   └── PingController    ← /api/ping 健康检查
    ├── config/
    │   ├── SecurityConfig    ← Spring Security 配置
    │   ├── AsyncConfig       ← 采集异步线程池 (core=2, max=4)
    │   └── DataInitializer   ← 启动时创建默认管理员
    ├── error/
    │   └── GlobalExceptionHandler ← 全局 @RestControllerAdvice
    └── security/
        ├── JwtUtil           ← Token 生成/解析/校验
        ├── JwtAuthenticationFilter ← 请求拦截过滤器
        └── JwtPrincipal      ← 认证主体 record
```

### 3.2 核心采集流程（已实现）

```
POST /api/collection-runs/sites/{id}
  ↓
Controller (同步): 创建 RUNNING 任务, 返回 202 + runId
  ↓
@Async("collectionTaskExecutor"): 后台线程执行
  ↓
resolveCollector(site):
  ├─ site.rssUrl 非空 → RssCollector (Rome 解析 RSS 2.0 / Atom)
  └─ site.rssUrl 为空 → HtmlCollector (Jsoup 抓取)

[RssCollector 路径]
  ↓
new URL(feedUrl).openConnection() → SyndFeedInput.build()
  ↓
遍历 SyndEntry → 提取 title/link/description/pubDate
  ↓
生成 SHA-256 sourceHash (ArticleParser.generateSourceHash)
  ↓
article.isBlank()? 或 link.isBlank()? → 跳过无效条目
  ↓
max 50 条 → CollectResult

[HtmlCollector 路径]
  ↓
Jsoup.connect(site.getUrl()).get() → 首页 HTML
  ↓
SELECTOR 匹配文章链接 (article/news/blog/post/202/p/ 模式)
  ↓
同域名过滤 → max 20 条
  ↓
逐个 fetch 详情页 → ArticleParser.extractContent() 提取正文
  ↓
ArticleParser.extractPublishedDate() 提取发布时间
  ↓
CollectResult

[采集编排器 - CollectionOrchestrator]
  ↓
Collector.collect(site) → CollectResult(rawArticles)
  ↓
RSS 失败 (ParseException) → 自动降级 HTML 采集器
  ↓
ArticleService.batchSaveArticles():
  ├─ sourceHash 去重检查 (existsByUserIdAndSourceHash)
  └─ saveAll() 批量落库
  ↓
llmTaskExecutor（并发 5 篇）→ DashScope Chat API
  │
  ├─ llm-1 → SummaryResult(标题/摘要/要点/标签)
  ├─ llm-2 → SummaryResult(...)
  ├─ llm-3 → SummaryResult(...)
  ├─ llm-4 → SummaryResult(...)
  ├─ llm-5 → SummaryResult(...)  (maxConcurrency=5)
  │
  ├─ 成功 → ArticleService.updateLlmSummary()
  ├─ 失败 → log.warn（单篇不影响其他篇）
  └─ 超时 → orTimeout(10min) 保护采集线程
  │
CollectionRunService.complete(runId, savedCount)
  │
  └─ 异常 → CollectionRunService.fail(runId, errorMessage)
```

### 3.3 数据库表关系

```
app_users (1) ──→ (N) categories        # 用户 → 分类
app_users (1) ──→ (N) sites             # 用户 → 网站
app_users (1) ──→ (N) articles          # 用户 → 文章
app_users (1) ──→ (N) collection_runs   # 用户 → 任务
app_users (1) ──→ (N) favorites         # 用户 → 收藏

categories (1) ──→ (N) sites           # 分类 → 网站
categories (1) ──→ (N) articles        # 分类 → 文章
sites (1) ──→ (N) articles             # 网站 → 文章
articles (1) ──→ (N) favorites         # 文章 → 收藏
```

所有业务表均通过 `user_id` 进行数据隔离。

### 3.4 认证与安全

```
客户端请求 → JwtAuthenticationFilter
  ├─ 请求头含 Authorization: Bearer <token>?
  │   ├─ 是 → 解析 Token → 设置 SecurityContext → 放行
  │   └─ 否 → 放行（让 Security 决定）
  └─ 请求路径是否公开?
      ├─ /actuator/health → 公开
      ├─ /api/ping → 公开
      ├─ /api/auth/login → 公开
      └─ 其他 → 需要认证
```

- Token 使用 HMAC-SHA256 签名
- 密钥: `app.security.jwt-secret`（从环境变量读取）
- 过期时间: `app.security.jwt-expires-in-seconds`（默认 86400 秒 = 24h）
- 默认管理员: `admin / admin123`（首次启动自动创建）

### 3.5 API 端点清单

| 方法 | 路径 | 说明 | 认证 |
|---|---|---|---|
| POST | `/api/auth/login` | 登录获取 Token | 否 |
| POST | `/api/auth/me` | 当前用户信息 | 是 |
| GET | `/api/ping` | 心跳检测 | 否 |
| GET | `/api/categories` | 分类列表(?includeArchived=true) | 是 |
| GET | `/api/categories/{id}` | 分类详情 | 是 |
| POST | `/api/categories` | 创建分类 | 是 |
| PUT | `/api/categories/{id}` | 更新分类(局部) | 是 |
| DELETE | `/api/categories/{id}` | 删除分类 | 是 |
| GET | `/api/sites` | 网站列表(?categoryId=) | 是 |
| GET | `/api/sites/{id}` | 网站详情 | 是 |
| POST | `/api/sites` | 创建网站 | 是 |
| PUT | `/api/sites/{id}` | 更新网站(局部) | 是 |
| DELETE | `/api/sites/{id}` | 删除网站 | 是 |
| GET | `/api/articles` | 文章列表(分页+筛选) | 是 |
| GET | `/api/articles/{id}` | 文章详情 | 是 |
| GET | `/api/articles/favorites` | 收藏列表 | 是 |
| POST | `/api/articles/{id}/favorite` | 切换收藏 | 是 |
| DELETE | `/api/articles/{id}/favorite` | 取消收藏 | 是 |
| GET | `/api/articles/count` | 文章统计 | 是 |
| GET | `/api/collection-runs` | 任务历史 | 是 |
| **POST** | **`/api/collection-runs/sites/{id}`** | **手动触发采集（202 Accepted）** | 是 |
| GET | `/actuator/health` | 健康检查 | 否 |

---

## 4. 前端模块详解

### 4.1 页面路由

```
/login           → LoginView.vue         (公开)
/dashboard       → DashboardView.vue     (需登录, 默认首页)
/categories      → CategoriesView.vue    (需登录)
/sites           → SitesView.vue         (需登录)
/collection-runs → CollectionRunsView.vue (需登录)
```

所有受保护路由在 `AppLayout.vue` 内渲染，布局包含左侧导航 + 顶部操作栏。

### 4.2 API 调用链

```
Vue View → API Service (api/*.ts) → Axios Instance (client.ts)
    ↓                                           ↓
后端 Controller ← 请求拦截器注入 JWT Token ← localStorage
```

### 4.3 状态管理

`stores/auth.ts` — Pinia Store：
- `state`: token, username, role（从 localStorage 恢复）
- `getters`: isAuthenticated
- `actions`: login(), logout()

### 4.4 前端注意事项

- `ApiResponse<T>` 类型在后端 `ApiResponse.java` 和前端 `types.ts` 中各定义一份，必须保持同步
- 所有 API 服务文件使用 `apiClient.get/post/put/delete`，自动携带 Token
- 后端未启动时视图静默降级，不崩溃

---

## 5. 关键设计决策

### 5.1 为什么用 Flyway 而非 JPA ddl-auto: update?

生产环境中使用 `validate` 模式，确保数据库结构变更受版本控制。开发/测试环境中使用 `create-drop`。

### 5.2 为什么用 Lombok @Data?

所有实体类使用 `@Data @NoArgsConstructor @AllArgsConstructor` 替代手写 getter/setter。
`@Data` = @Getter + @Setter + @ToString + @EqualsAndHashCode + @RequiredArgsConstructor。
JPA 需要无参构造函数，因此额外保留 `@NoArgsConstructor`。
DTO 和配置类使用 Java 16+ record（无需 Lombok）。

### 5.3 为什么统一响应用 ApiResponse<T>?

所有 REST 接口返回统一结构，前端可根据 `success` 字段快速判断，错误处理集中到全局异常处理器。

### 5.4 用户数据隔离方案

所有实体包含 `userId` 字段，Service 层和 Repository 层方法均接受 `userId` 参数，Controller 层通过 `@AuthenticationPrincipal JwtPrincipal` 获取当前用户。**永不可信任客户端提供的 userId**。

### 5.5 采集器设计模式：策略模式

`Collector` 接口定义采集抽象，`RssCollector` 和 `HtmlCollector` 分别实现。
`CollectionOrchestrator` 按 Site 配置动态选择采集器。新增采集类型只需实现 `Collector` 接口并注册为 `@Component`。

### 5.6 异步解耦：@Async + 202 Accepted

采集和 LLM 调用各使用独立线程池，互不干扰。

### 5.7 LLM 并发调用：CompletableFuture

LLM 摘要通过独立的 `llmTaskExecutor` 线程池并发执行，`CompletableFuture.allOf()` 等待全部完成。
`orTimeout(10, MINUTES)` 保护整体超时，`exceptionally()` 兜底降级。（含 runId），实际采集在 `@Async` 线程池中异步执行。
前端可通过轮询 `GET /api/collection-runs` 获取任务状态。避免长时间阻塞 HTTP 连接。

---

## 6. 当前实现状态

### ✅ 已实现

- [x] **采集核心链路** — Collector 策略接口 + RssCollector（Rome）+ HtmlCollector（Jsoup）+ CollectionOrchestrator（异步编排 + RSS→HTML 降级）
- [x] **文章提取工具** — ArticleParser（正文提取/日期提取/SHA-256 哈希）
- [x] **采集异常体系** — CollectorException / ConnectionTimeoutException / ParseException / EmptyResultException
- [x] **异步线程池** — AsyncConfig（core=2, max=4, queue=10）
- [x] **批量去重落库** — ArticleService.batchSaveArticles()（@Transactional + sourceHash 过滤）
- [x] **202 Accepted 异步响应** — CollectionRunController 改造
- [x] 后端项目结构（实体/Repository/Service/Controller 全链路）
- [x] JWT 认证（登录/Token 发放/请求过滤/用户数据隔离）
- [x] 分类管理（完整 CRUD）
- [x] 网站管理（完整 CRUD）
- [x] 文章查询（分页/详情/收藏/统计）
- [x] 采集任务记录（历史查询/手动触发）
- [x] LLM 抽象层（接口 + DashScope 骨架实现）
- [x] Flyway 数据库迁移（6 张基础表）
- [x] 前端完整布局与视图
- [x] Docker Compose 部署编排
- [x] 企业级注释（package-info / Javadoc / 中文文档）
- [x] **单元测试 + 集成测试**（ArticleParser: 15 / RssCollector: 9 / CollectionOrchestrator: 6）
- [x] **测试环境**（H2 内存数据库，Redis 排除，与开发环境隔离）

### 🔲 待实现（按优先级排序）

1. ~~大模型集成~~ — ✅ 已实现

### 第二阶段（定时调度 + 前端完善）

3. **定时采集调度**
   - `@Scheduled` + `SiteRepository.findByUserIdAndEnabledTrue()`
   - Redis 任务锁防止重复调度（`spring-integration-redis` 或自定义）
4. **文章详情页**
   - 前端新增详情抽屉或详情路由
   - 展示摘要/要点/标签/来源链接
5. **收藏管理页面**
   - `GET /api/articles/favorites` 已就绪，前端补页面

### 第三阶段（体验完善）

6. 全文搜索（PostgreSQL `pg_trgm` 或 Elasticsearch）
2. 用户注册接口
3. 多 Provider 支持（OpenAI、Claude 等）
4. 采集失败自动重试 + 通知机制

---

## 11. 关键文件快速跳转

### 后端核心文件

| 文件路径 | 说明 |
|---|---|
| `backend/pom.xml` | 依赖管理，含 Lombok/Rome/Jsoup |
| `backend/src/main/resources/application.yml` | 主配置，含 `repair-on-migrate` |
| `backend/src/main/java/.../collection/CollectionOrchestrator.java` | **采集编排器入口** |
| `backend/src/main/java/.../collection/RssCollector.java` | RSS 采集器（可测试：protected buildFeed） |
| `backend/src/main/java/.../collection/HtmlCollector.java` | HTML 采集器（同域名过滤） |
| `backend/src/main/java/.../collection/ArticleParser.java` | 正文/日期提取工具 |
| `backend/src/main/java/.../collection/Collector.java` | 策略接口，扩展新采集类型实现此接口 |
| `backend/src/main/java/.../common/config/AsyncConfig.java` | 异步线程池配置 |
| `backend/src/main/java/.../common/security/JwtUtil.java` | JWT 工具 |
| `backend/src/main/java/.../llm/DashScopeLlmProvider.java` | DashScope 真实 API（RestTemplate + 外置模板） |
| `backend/src/main/resources/prompt_template/article-zh-llm-summary-prompt.stg` | LLM 提示词模板（模板与代码分离） |
| `backend/src/main/java/.../common/config/AsyncConfig.java` | 双线程池（collect- + llm-）
| `backend/src/main/resources/db/migration/V1__initial_schema.sql` | 初始表结构 |

### 测试文件

| 文件路径 | 说明 |
|---|---|
| `backend/src/test/java/.../collection/ArticleParserTest.java` | 15 个用例 |
| `backend/src/test/java/.../collection/RssCollectorTest.java` | 9 个用例 |
| `backend/src/test/java/.../collection/CollectionOrchestratorIntegrationTest.java` | 6 个集成用例 |
| `backend/src/test/resources/application-test.yml` | H2 测试配置 |
| `backend/src/test/resources/test-rss.xml` | RSS 测试夹具（6 条 item） |

### 前端核心文件

| 文件路径 | 说明 |
|---|---|
| `frontend/src/types.ts` | 类型定义，需与后端 Entity 同步 |
| `frontend/src/api/client.ts` | Axios 实例 + Token 注入 |
| `frontend/src/stores/auth.ts` | 认证状态管理 |
| `frontend/src/router/index.ts` | 路由 + 鉴权守卫 |

### 文档

| 文件路径 | 说明 |
|---|---|
| `docs/网页数据采集方案-初版.md` | 采集方案设计文档（含 9 个章节） |
| `docs/采集链路测试指南.md` | Postman 测试流程与用例 |

---

> 本文档由 Codex 维护。每次重大功能变更后请同步更新对应章节。