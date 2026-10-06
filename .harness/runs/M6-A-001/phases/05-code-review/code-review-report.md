# M6-A-001 代码审核报告

## 审核方式

- 独立只读 code-reviewer 审核当前任务差异。
- 检查需求、技术设计、任务 DAG、前后端契约、权限、迁移、失败状态、移动端布局和测试覆盖。

## BLOCKER

无。

## WARNING

### W1：详情异步请求存在旧响应覆盖风险

- 文件：`frontend/src/views/DashboardView.vue`、`frontend/src/views/FavoritesView.vue`
- 证据：详情 GET 和后续 markRead 响应直接写入全局 `selectedArticle`，关闭或切换文章时没有请求身份校验。
- 影响：慢请求可能覆盖后来打开的文章，后续状态操作可能针对错误文章。
- 处理：增加详情请求序号；响应落地前确认抽屉仍打开且请求仍为当前请求。

### W2：阅读状态写失败缺少用户反馈和重试入口

- 文件：`frontend/src/views/DashboardView.vue`、`frontend/src/views/FavoritesView.vue`
- 证据：自动标记已读和手动标记未读失败均静默保留原状态。
- 影响：用户无法判断状态为何没有变化，也无法在当前详情中重试标记已读。
- 处理：显示明确失败消息；未读详情提供“标记已读”按钮，已读详情提供“标记未读”按钮。

### W3：HTTP 接口和核心幂等契约缺少直接测试

- 文件：`backend/src/test/java/com/frontierscan/article/ArticleReadStatusTest.java`
- 缺口：PUT/DELETE 映射与响应、跨用户未读操作、默认未读、重复标记已读不重置时间。
- 处理：补充最小 Controller/API 契约测试和 Service/持久化断言。

## NOTE

- Flyway `V11`、JPA 字段和 JPQL 投影参数匹配。
- 未发现跨用户数据泄露。
- 两个页面在 `720px` 以下将详情动作区切换为纵向布局，源码检查未见按钮重叠。
- 真实 PostgreSQL 迁移、认证 HTTP 调用和浏览器交互仍由后续阶段验证。

## 修复记录

- W1：看板和收藏页均增加 `detailRequestId`，GET、自动已读和手动状态请求只允许当前详情请求更新状态。
- W2：增加 `role="alert"` 错误反馈；未读详情提供“标记已读”重试，已读详情提供“标记未读”。
- W3：增加真实 `MockMvc` + JWT Security Filter 集成测试，覆盖未认证、owner PUT/DELETE、跨用户 404 和 JSON 响应；Service 测试补充默认空值、幂等时间和跨用户未读。
- 修复后定向后端测试 20/20、前端构建通过。

## 当前结论

最终独立复审确认：

- 原 W1/W2/W3 全部关闭。
- 手动状态请求的 pending 竞态已关闭。
- MockMvc + JWT Security Filter HTTP 契约测试已补齐。
- 未发现新增 BLOCKER 或 WARNING。

代码审核通过。
