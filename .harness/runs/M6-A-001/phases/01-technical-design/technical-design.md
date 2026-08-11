# M6-A-001 技术设计

## 方案比较

### 方案 A：`articles.read_at` + 显式写接口（采用）

- 在文章表增加可空 `read_at timestamptz`。
- `PUT /api/articles/{id}/read` 标记已读并返回更新后的文章。
- `DELETE /api/articles/{id}/read` 标记未读并返回更新后的文章。
- 前端详情加载成功后调用 `PUT`，详情中提供重新标记未读按钮。

优点：改动最小，保留首次/最近标记时间，接口语义清晰，直接复用文章的用户归属校验。

### 方案 B：`articles.is_read` 布尔字段

优点是字段直观；缺点是丢失阅读时间，未来若只需展示“已读于”仍需再次迁移。代码量与方案 A 基本相同，因此不采用。

### 方案 C：独立 `article_reads` 关系表

适合一篇全局文章被多个用户共享的模型。当前文章已经归属单一用户，引入关系表会增加实体、仓储、联表和清理成本，因此不采用。

## 后端设计

- `Article` 新增 `OffsetDateTime readAt`，JSON 中 `null` 表示未读。
- `ArticleService.markAsRead(userId, articleId)` 先复用 `getById` 校验归属，再写入当前时间。
- `ArticleService.markAsUnread(userId, articleId)` 先校验归属，再清空 `readAt`。
- 两个方法使用事务，重复标记保持幂等。
- `ArticleController` 暴露 `PUT/DELETE /api/articles/{id}/read`。
- 收藏列表投影增加 `readAt`，避免收藏页逐条请求详情。

## 前端设计

- `Article` 和 `FavoriteArticle` 增加 `readAt: string | null`。
- `articleApi` 增加 `markRead(id)` 与 `markUnread(id)`。
- 看板和收藏卡片在标题附近显示低干扰的“未读/已读”文本标记，未读使用现有警示色，已读使用中性色。
- 打开详情时先获取详情，再调用 `markRead`；写入成功后同步当前列表项与详情。
- 详情动作区提供“标记未读”按钮；操作期间禁用按钮，失败时保留服务端已知状态。
- 不增加新依赖，不改变整体布局与色板。

## 数据流

```text
点击文章卡片
  -> GET /api/articles/{id}
  -> PUT /api/articles/{id}/read
  -> 返回 readAt 非空的 Article
  -> 同步详情和当前列表

点击“标记未读”
  -> DELETE /api/articles/{id}/read
  -> 返回 readAt 为空的 Article
  -> 同步详情和当前列表
```

## 错误与安全

- 文章不存在或不属于当前用户时统一抛出 `ResourceNotFoundException`。
- 自动标记已读失败不关闭已成功加载的详情，但前端不虚构成功状态。
- 状态按钮防止重复提交。
- 不接受客户端传入 `userId` 或时间值。

## 测试策略

- RED：Service 测试覆盖标记已读、标记未读和跨用户拒绝。
- RED：集成测试覆盖数据库字段持久化和 API 状态变化。
- GREEN：实现最小实体、迁移、Service、Controller 代码。
- 前端当前无测试框架，以 `vue-tsc --noEmit` 和 Vite build 作为静态验证，并通过浏览器/API 完成行为验证。
