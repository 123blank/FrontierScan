# M7-D-001 技术设计

## 1. 目标与边界

本 Story 在 Dashboard 文章列表增加“全部、未读、已读”三个互斥筛选项，并让后端文章列表接口支持 `readStatus=all|unread|read`。

本次只修改文章列表查询与 Dashboard 筛选，不修改 Favorites，不增加统计、批量操作、状态持久化或数据库迁移。

## 2. 现状核验

- `ArticleController.list` 从当前 `JwtPrincipal` 获取 `userId`，并把列表条件交给 `ArticleService.listByUser`。
- `ArticleService.listByUser` 在没有搜索条件时使用派生查询，有搜索条件时使用 `ArticleRepository.findWithFilters`。
- `findWithFilters` 的主查询和 `countQuery` 都以 `a.user_id = :userId` 作为用户隔离条件。
- `Article.readAt` 已存在，可以直接表达已读和未读，不需要修改数据模型。
- Dashboard 已有分类、关键词、标签、日期和分页状态，筛选变化会把 `currentPage` 重置为 `0` 后重新加载列表。
- 前端目前没有组件测试框架，本 Story 不引入新的测试依赖。

## 3. 设计决策

### TD-READ-1：使用受限字符串参数

文章列表接口增加可选参数 `readStatus`，默认值为 `all`，允许值仅为 `all`、`read`、`unread`。

Controller 使用 Bean Validation 在 HTTP 边界拒绝非法值；Service 再执行同样的最小白名单校验，保护直接调用和未来调用方。非法值必须在 Repository 查询前失败。

### TD-READ-2：复用现有原生组合查询

`readStatus=all` 且没有其他搜索条件时，继续复用现有派生查询，保持当前默认路径。

`readStatus=read|unread` 时进入现有 `findWithFilters`，在主查询和 `countQuery` 同时增加：

```sql
and (
  :readStatus = 'all'
  or (:readStatus = 'unread' and a.read_at is null)
  or (:readStatus = 'read' and a.read_at is not null)
)
```

查询继续使用当前认证用户的 `userId`，不接受前端传入用户标识。

### TD-READ-3：Dashboard 使用独立分段控件

Dashboard 在现有文章筛选条附近增加独立的阅读状态分段控件，状态类型为：

```typescript
type ReadStatusFilter = 'all' | 'unread' | 'read';
```

默认选择 `all`。切换到不同状态时：

1. 更新选中状态；
2. 将 `currentPage` 设置为 `0`；
3. 使用现有 `reloadArticlePage` 重新请求；
4. 请求始终明确携带当前 `readStatus`。

控件使用原生按钮、`aria-pressed` 和禁用状态，不修改 Favorites 页面或 Favorites API。

### TD-READ-4：验证采用后端 TDD 与前端例外

后端先增加 Service、Repository 集成和 HTTP 参数测试并确认 RED，再完成生产代码使测试 GREEN。

前端因仓库没有组件测试框架，本次记录 TDD 例外，不新增依赖；使用 TypeScript/Vite 构建和真实浏览器请求、DOM、分页状态验证覆盖界面行为。

## 4. 影响范围

### 后端

- `backend/src/main/java/com/frontierscan/article/ArticleController.java`
- `backend/src/main/java/com/frontierscan/article/ArticleService.java`
- `backend/src/main/java/com/frontierscan/article/ArticleRepository.java`
- 文章筛选、API 参数和用户隔离相关测试

### 前端

- `frontend/src/api/articles.ts`
- `frontend/src/views/DashboardView.vue`

### 公共契约

- `GET /api/articles` 增加向后兼容的可选查询参数 `readStatus`。
- 未提供参数与 `readStatus=all` 保持现有语义。

## 5. 验收映射

| 验收标准 | 设计覆盖 |
| --- | --- |
| `AC-READ-FILTER-1` | `unread` 映射到 `a.read_at is null`，Dashboard 发送并展示对应结果 |
| `AC-READ-FILTER-2` | `read` 映射到 `a.read_at is not null`，Dashboard 发送并展示对应结果 |
| `AC-READ-FILTER-3` | `all` 保留现有路径，原生查询同时支持既有组合条件和分页 |
| `AC-READ-FILTER-4` | Controller 与 Service 双层白名单校验，所有查询继续绑定 principal `userId` |
| `AC-READ-FILTER-5` | 分段控件状态、显式请求参数、`currentPage=0` 和重新加载保持一致 |

## 6. 风险与缓解

### RISK-READ-COUNT

风险：主查询与 `countQuery` 条件不一致会导致分页总数错误。

缓解：两段 SQL 同时增加相同条件，并用分页集成测试覆盖。

### RISK-READ-VALIDATION

风险：只在 Controller 校验会让直接 Service 调用接受非法状态。

缓解：Controller 负责 HTTP 400，Service 在 Repository 调用前再次校验。

### RISK-READ-UI

风险：前端没有组件测试框架，构建成功不能证明请求和分页行为正确。

缓解：不为单个 Story 引入新框架，使用真实浏览器拦截请求并验证 `aria-pressed`、`readStatus`、`page=0` 和列表 DOM。

## 7. 知识状态

技术设计开始时 `backend`、`frontend`、`common` 三个相关知识域均检测为 stale。设计已使用目标源码核验；State 推进前仍必须通过 Harness 正式刷新，或由用户逐域批准 `accepted-stale`。本 Story 选择刷新，不接受 stale。
