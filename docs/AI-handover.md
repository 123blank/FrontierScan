# FrontierScan Agent — AI 交接文档

> **本文档目标**：让零上下文的新 AI 在阅读后，能够完全理解项目全貌，无缝接手继续业务开发。
> 编写日期：2026-06-11 | 项目版本：0.1.0-SNAPSHOT

---

## 1. 项目概述

### 一句话

FrontierScan 是一个**企业级 Web Agent 系统**，用于自动采集技术/AI 前沿网站信息，通过大模型进行摘要处理，并按分类以卡片形式展示。

### 核心能力

1. **信息源管理** — 用户自定义分类和网站（支持 RSS/Atom + 网页解析）
2. **自动采集** — 手动触发 + 定时调度，优先 RSS、降级到网页解析
3. **AI 摘要** — 阿里 DashScope/Qwen 大模型生成摘要、要点、标签
4. **阅读助手** — 分屏索引、搜索、收藏、按分类/来源/时间筛选
5. **用户隔离** — JWT 认证，每个用户只能看到自己的数据

### 技术栈

| 层级 | 技术 | 版本 |
|---|---|---|
| 后端框架 | Spring Boot | 3.3.5 |
| JDK | Java | 17 |
| 构建工具 | Maven | 3.9.9 |
| 前端框架 | Vue 3 | 3.5.12 |
| 语言 | TypeScript | 5.6.3 |
| 构建 | Vite | 4.5.5 |
| 数据库 | PostgreSQL | 16 (Docker) |
| 缓存 | Redis | 7 (Docker) |
| 部署 | Docker Compose | 1 文件启动 |
| 大模型 | DashScope / Qwen | 可切换 |

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
│       │   ├── collection/           # 采集任务模块
│       │   ├── llm/                  # 大模型抽象层
│       │   └── common/               # 公共基础设施
│       │       ├── api/              # 统一响应 + Ping 端点
│       │       ├── config/           # Security + 数据初始化
│       │       ├── error/            # 全局异常处理
│       │       └── security/         # JWT 工具 + 过滤器
│       ├── main/resources/
│       │   ├── application.yml       # 主配置（环境变量覆盖）
│       │   └── db/migration/         # Flyway 迁移
│       └── test/                     # 测试代码
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
│   └── AI-handover.md                # ← 本文档
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
│   ├── ArticleService        ← 业务逻辑 + 去重
│   ├── ArticleRepository     ← JPA 接口(多维分页)
│   └── FavoriteRepository    ← JPA 接口
│
├── collection (采集任务)
│   ├── CollectionRun         ← 实体: collection_runs 表
│   ├── CollectionRunController ← 历史 + 手动触发
│   ├── CollectionRunService  ← 状态机(RUNNING→COMPLETED/FAILED)
│   └── CollectionRunRepository ← JPA 接口
│
├── llm (大模型)
│   ├── LlmProvider           ← 接口: 摘要抽象
│   ├── DashScopeLlmProvider  ← DashScope 实现(当前为骨架)
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
    │   └── DataInitializer   ← 启动时创建默认管理员
    ├── error/
    │   └── GlobalExceptionHandler ← 全局 @RestControllerAdvice
    └── security/
        ├── JwtUtil           ← Token 生成/解析/校验
        ├── JwtAuthenticationFilter ← 请求拦截过滤器
        └── JwtPrincipal      ← 认证主体 record
```

### 3.2 核心业务流程

```
用户操作 → Controller → Service → Repository → Database
                                    ↓
                               LlmProvider (采集完成后)
                                    ↓
                              SummaryResult
```

具体采集流程（**待实现**）：

```
1. 前端 POST /api/collection-runs/sites/{id} 触发采集
2. 后端创建 CollectionRun(status=RUNNING)
3. 检查 Site.rssUrl 是否有 RSS 订阅
   ├─ 有: 解析 RSS/Atom XML → 提取文章列表
   └─ 无: HTTP GET 抓取网页 → 解析 HTML → 提取文章列表
4. 逐篇文章检查 sourceHash 去重
5. 调用 LlmProvider.summarize() 生成摘要
6. 保存 Article 到数据库
7. 更新 CollectionRun(status=COMPLETED, collectedCount)
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
| POST | `/api/collection-runs/sites/{id}` | 手动触发采集 | 是 |
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

生产环境中使用 `validate` 模式，确保数据库结构变更受版本控制。开发测试环境中使用 `create-drop`。

### 5.2 为什么用 record 而非 @Data (Lombok)?

避免引入 Lombok 编译期注解处理的复杂性。实体类手写 getter/setter，DTO 使用 Java 16+ record。

### 5.3 为什么统一响应用 ApiResponse<T>?

所有 REST 接口返回统一结构，前端可根据 `success` 字段快速判断，错误处理集中到全局异常处理器。

### 5.4 用户数据隔离方案

所有实体包含 `userId` 字段，Service 层和 Repository 层方法均接受 `userId` 参数，Controller 层通过 `@AuthenticationPrincipal JwtPrincipal` 获取当前用户。**永不可信任客户端提供的 userId**。

---

## 6. 当前实现状态

### ✅ 已实现

- [x] 后端项目结构（实体/Repository/Service/Controller 全链路）
- [x] JWT 认证（登录/Token 发放/请求过滤/用户数据隔离）
- [x] 分类管理（完整 CRUD）
- [x] 网站管理（完整 CRUD）
- [x] 文章查询（分页/详情/收藏/统计）
- [x] 采集任务记录（历史查询/手动触发）
- [x] LLM 抽象层（接口 + DashScope 骨架实现）
- [x] Flyway 数据库迁移（6 张基础表）
- [x] 前端布局（侧边栏/顶部操作栏/响应式）
- [x] 前端路由与鉴权守卫
- [x] 登录页/信息看板/分类管理/网站管理/任务记录视图
- [x] 前后端 API 对接（全链路调通）
- [x] 统一响应格式 + 全局异常处理
- [x] CORS 配置 + 前端开发代理
- [x] Docker Compose 部署编排
- [x] 企业级注释（package-info / Javadoc / 中文文档）
- [x] 测试配置（H2 替代 PostgreSQL）

### 🔲 待实现（按优先级排序）

1. **采集核心逻辑** — 最高优先级
   - RSS/Atom 解析器（Rome 或自建）
   - HTML 网页提取器（Jsoup）
   - 去重逻辑（sourceHash 比较）
   - 任务状态机（RUNNING → COMPLETED/FAILED）
   - 定时调度（@Scheduled 或 Quartz）

2. **大模型集成** — 高优先级
   - DashScopeLlmProvider 接入真实 HTTP API
   - LLM 调用失败时的降级策略
   - 摘要结果的结构化解析

3. **前端增强**
   - 文章详情抽屉/页面
   - 搜索功能（结合后端全文检索）
   - 个人收藏页面
   - 文章卡片组件优化（标签着色、时间友好显示）

4. **平台化能力**
   - 用户注册接口
   - 多个大模型 Provider 切换（如 OpenAI、Claude）
   - 采集频率个性化配置
   - 通知/告警机制

---

## 7. 开发指南

### 7.1 环境要求

- JDK 17+
- Node.js 20+
- Maven 3.9+（使用捆绑的 `mvnw` 或系统安装）
- Docker + Docker Compose（可选，推荐）

### 7.2 快速启动（Docker Compose）

```powershell
cd D:\ProjectStudy\FrontierScan
copy .env.example .env
docker compose up --build
```

访问 `http://localhost:3000`，默认管理员 `admin / admin123`。

### 7.3 本地开发（无 Docker）

**后端**（需要本地 PostgreSQL + Redis）：
```powershell
cd backend
mvn spring-boot:run
```

**前端**：
```powershell
cd frontend
npm install
npm run dev
```

前端开发服务器 `http://localhost:5173`，已配置 API 代理到 `localhost:8080`。

### 7.4 运行测试

```powershell
cd backend
mvn test -P test          # 使用 H2 内存数据库
```

### 7.5 构建生产包

```powershell
# 后端
cd backend && mvn package -DskipTests
# 前端
cd frontend && npm run build
```

---

## 8. 编码规范

### 8.1 后端 Java

- **实体**: JPA `@Entity` + `@Table`，所有字段手写 getter/setter，字段级别 `@Column` 注释
- **Repository**: 继承 `JpaRepository`，方法名遵循 Spring Data 命名约定
- **Service**: `@Service`，构造器注入，方法级 Javadoc
- **Controller**: `@RestController`，返回 `ApiResponse<T>`，从 `@AuthenticationPrincipal` 获取用户
- **DTO**: Java record 类型
- **配置**: `@ConfigurationProperties` + record 类型
- **注释**: 类级 Javadoc + 方法级 `@param/@return + 业务描述`
- **命名**: 驼峰命名，表名 `snake_case`，Java 字段 `camelCase`

### 8.2 前端 TypeScript/Vue

- **类型**: `types.ts` 中定义接口，与后端 `ApiResponse.java` / Entity 保持同步
- **API**: 每个业务模块一个 `api/*.ts` 文件，封装 Axios 调用
- **状态**: Pinia Store，`defineStore('name', {state, getters, actions})`
- **组件**: `<script setup lang="ts">`，scoped CSS
- **注释**: 组件用 `<!-- 组件说明 -->`，方法用 `/** JSDoc */`

### 8.3 数据库迁移

- SQL 文件命名：`V{版本号}__{描述}.sql`
- **已应用的迁移不可修改内容**（Flyway 校验和检测）
- 如需变更，创建新版本的迁移文件

---

## 9. 已知问题

1. **Jackson 版本冲突已修复**
   - 问题：jjwt BOM 覆写 Spring Boot 的 Jackson 版本管理
   - 修复：移除 jjwt BOM import，使用显式版本
   - 验证：`mvn dependency:tree | Select-String jackson-databind` 应显示 2.17.2

2. **Flyway 校验和**
   - 如果修改已有迁移文件的注释，Flyway 会检测到校验和不匹配
   - 开发环境已配置 `spring.flyway.repair-on-migrate: true` 自动修复
   - 生产环境使用全新数据库，不涉及此问题

3. **Lombok 未使用**
   - 实体类手动编写 getter/setter，代码冗长但有明确意图
   - 后续可引入 Lombok 简化，但需要团队成员同意

4. **前端搜索功能未对接后端**
   - 顶部搜索框已渲染但功能为空
   - 需后端实现 `GET /api/articles?search=` 参数支持

---

## 10. 下一步工作建议

### 第一阶段（核心功能可运行）

1. 实现 **RSS 采集器**（`collection` 包中新增 `RssCollector` 服务）
2. 实现 **网页采集器**（`HtmlCollector`，使用 Jsoup）
3. 接入 **DashScope API**（`DashScopeLlmProvider` 补全 HTTP 调用）
4. 实现 **定时调度**（`@Scheduled` 注解，按 `Site.collectionIntervalMinutes` 执行）
5. 完成 **文章详情页**（前端抽屉或路由页面）

### 第二阶段（体验完善）

6. 全文搜索（基于 PostgreSQL `pg_trgm` 或 Elasticsearch）
7. 用户注册
8. 收藏列表管理页面
9. 采集失败的自动重试
10. 多 Provider 支持（OpenAI、Claude 等）

### 第三阶段（企业级）

11. 完整 RBAC 权限体系
12. 操作审计日志
13. 多租户支持
14. 分布式任务调度

---

## 11. 关键文件快速跳转

### 后端核心文件

| 文件路径 | 说明 |
|---|---|
| `backend/pom.xml` | 依赖管理，已移除 jjwt BOM |
| `backend/src/main/resources/application.yml` | 主配置，含 `repair-on-migrate` |
| `backend/src/main/java/com/frontierscan/common/security/JwtUtil.java` | JWT 工具 |
| `backend/src/main/java/com/frontierscan/llm/DashScopeLlmProvider.java` | LLM 骨架实现 |
| `backend/src/main/resources/db/migration/V1__initial_schema.sql` | 初始表结构 |

### 前端核心文件

| 文件路径 | 说明 |
|---|---|
| `frontend/src/types.ts` | 类型定义，需与后端 Entity 同步 |
| `frontend/src/api/client.ts` | Axios 实例 + Token 注入 |
| `frontend/src/stores/auth.ts` | 认证状态管理 |
| `frontend/src/router/index.ts` | 路由 + 鉴权守卫 |

---

> 本文档由 Codex 生成于 2026-06-11。如有更新，请更新本文档以保持交接信息的准确性。