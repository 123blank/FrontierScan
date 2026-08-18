# M7-D-001 实现记录

## 实现结果

### 后端

- `GET /api/articles` 增加 `readStatus=all|read|unread`，默认值为 `all`。
- Controller 使用 `@Validated` 和 `@Pattern` 在 HTTP 边界拒绝非法参数。
- Service 保留原有签名作为 `all` 兼容入口，并在新签名中于 Repository 查询前执行白名单校验。
- `readStatus=read|unread` 复用 `findWithFilters`。
- 原生主查询和 `countQuery` 同时增加 `read_at` 条件。
- 所有查询继续使用当前 `JwtPrincipal.userId`。

### 前端

- `articleApi.list` 增加 `readStatus` 联合类型。
- Dashboard 增加“全部、未读、已读”独立分段控件。
- 默认选择“全部”，请求始终显式携带当前 `readStatus`。
- 切换状态时将 `currentPage` 重置为 `0` 并重新加载文章。
- 控件在加载期间禁用，并使用 `aria-pressed` 表达选中状态。
- Favorites 页面和 API 未修改。

## 开发方法

State 的全局 `method` 记录为 `exception`，因为前端没有组件测试框架。本次实际执行方法为：

- 后端：严格 TDD。
- 前端：经设计批准的局部例外，使用 TypeScript/Vite 构建和后续真实浏览器验证。

## RED 证据

第一次运行：

```text
mvn -q -Dtest=ArticleReadStatusApiIntegrationTest test
```

结果：失败。三个预期断言证明当前实现缺少目标行为：

- `readStatus=unread` 期望 1 条，实际 2 条。
- `readStatus=read` 期望 1 条，实际 2 条。
- `readStatus=unknown` 期望 HTTP 400，实际 200。

第二个 RED 循环：

```text
mvn -q -Dtest=ArticleServiceFilterTest test
```

结果：`shouldRejectInvalidReadStatusBeforeRepositoryQuery` 失败，原因是没有抛出异常。

## GREEN 证据

后端定向测试：

```text
mvn -q -Dtest=ArticleReadStatusApiIntegrationTest,ArticleServiceFilterTest test
```

结果：通过。

后端文章模块与用户隔离回归：

```text
mvn -q -Dtest=ArticleFilterIntegrationTest,ArticleServiceFilterTest,ArticleReadStatusTest,ArticleReadStatusApiIntegrationTest,UserDataIsolationIntegrationTest test
```

结果：通过。

前端构建：

```text
npm run build
```

结果：`vue-tsc --noEmit` 和 Vite build 均通过。

## 实际修改文件

- `backend/src/main/java/com/frontierscan/article/ArticleController.java`
- `backend/src/main/java/com/frontierscan/article/ArticleService.java`
- `backend/src/main/java/com/frontierscan/article/ArticleRepository.java`
- `backend/src/test/java/com/frontierscan/article/ArticleServiceFilterTest.java`
- `backend/src/test/java/com/frontierscan/article/ArticleReadStatusApiIntegrationTest.java`
- `frontend/src/api/articles.ts`
- `frontend/src/views/DashboardView.vue`

## 非目标确认

- 未修改 Favorites。
- 未增加数据库迁移。
- 未增加未读统计、批量操作或筛选持久化。
- 未执行 Git、Docker、发布或外部写操作。
