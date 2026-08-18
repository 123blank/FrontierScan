# M7-D-001 实现返工记录

## 返工原因

真实 Chrome 验收发现：文章在“未读”筛选中自动标记已读后会退出列表，但在详情中恢复未读时不会重新出现在列表中。

该缺陷在原 implementation、unit-test、code-review 和 build-publish 结果应用后才被发现。修复新增了两个实际业务文件，原 State 的 `implementation.actualFiles` 因而不再完整，旧下游门禁也不能继续代表当前实现。

## 修复结果

- 新增 `frontend/src/utils/readStatusFilter.ts`，集中判断活动阅读状态筛选下是否需要重新加载文章列表。
- 新增 `frontend/tests/readStatusFilter.test.ts`，以 Node 原生测试覆盖已读、未读和全部筛选行为。
- 更新 `frontend/src/views/DashboardView.vue`，在活动的已读或未读筛选下，每次成功修改阅读状态后重新加载列表。
- 新请求递增现有 `articleRequestId`，旧异步响应不能覆盖重新加载后的最新列表。
- 后端阅读状态筛选、参数校验、组合查询和用户隔离实现保持不变。

## 开发方法

- 后端初始实现采用严格 TDD。
- UI 验收发现的列表往返刷新缺陷采用 TDD：先增加失败的 helper 测试，再完成最小修复。
- Vue 组件交互仍沿用已批准的局部 TDD 例外，不引入新的组件测试依赖；通过前端构建和真实 Chrome 流程验收。

## 实际修改文件

- `backend/src/main/java/com/frontierscan/article/ArticleController.java`
- `backend/src/main/java/com/frontierscan/article/ArticleRepository.java`
- `backend/src/main/java/com/frontierscan/article/ArticleService.java`
- `backend/src/test/java/com/frontierscan/article/ArticleReadStatusApiIntegrationTest.java`
- `backend/src/test/java/com/frontierscan/article/ArticleServiceFilterTest.java`
- `frontend/src/api/articles.ts`
- `frontend/src/utils/readStatusFilter.ts`
- `frontend/src/views/DashboardView.vue`
- `frontend/tests/readStatusFilter.test.ts`

其中 `frontend/src/utils/readStatusFilter.ts` 与 `frontend/tests/readStatusFilter.test.ts` 未出现在原 DAG 的 `predictedFiles` 中，属于验收阶段发现缺陷后产生的预测外实际修改，必须进入最终 `outOfPredictionFiles`。

## 范围确认

- 未修改 Favorites。
- 未增加数据库迁移、未读统计、批量操作或筛选持久化。
- 未执行 Git 暂存、提交、推送、发布或部署。
