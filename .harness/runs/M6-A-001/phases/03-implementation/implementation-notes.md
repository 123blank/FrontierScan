# M6-A-001 实现记录

## 后端

- 新增 `V11__add_article_read_status.sql`，为 `articles` 增加可空 `read_at`。
- `Article` 增加 `readAt` 字段，空值表示未读。
- `ArticleService` 增加事务方法 `markAsRead`、`markAsUnread`，复用 `getById` 的用户归属校验。
- `ArticleController` 增加：
  - `PUT /api/articles/{id}/read`
  - `DELETE /api/articles/{id}/read`
- 收藏文章投影增加 `readAt`。

## 前端

- `Article`、`FavoriteArticle` 增加 `readAt`。
- `articleApi` 增加 `markRead`、`markUnread`。
- 看板与收藏卡片显示“已读/未读”。
- 详情成功加载后自动标记已读，并同步当前列表。
- 详情提供“标记未读”按钮，并同步当前列表。
- 阅读状态写入失败时保留已加载详情和服务端原状态。

## TDD 证据

1. RED：`mvn -Dtest=ArticleReadStatusTest test`
   - 因 `markAsRead`、`markAsUnread`、`readAt` 不存在而编译失败。
2. GREEN：补齐最小后端实现后，同一命令 3/3 通过。
3. 集成校验首次发现测试夹具旧实体和 H2 时间精度差异，修正断言后：
   - `mvn '-Dtest=ArticleReadStatusTest,UserDataIsolationIntegrationTest' test`
   - 16/16 通过。
4. 前端：
   - `npm run build`
   - `vue-tsc --noEmit` 与 Vite build 通过。

## 范围控制

- 未增加未读筛选、统计、批量操作、阅读次数或阅读历史。
- 未增加依赖。
- 未执行 Git 暂存、提交、推送、PR、发布或部署。
