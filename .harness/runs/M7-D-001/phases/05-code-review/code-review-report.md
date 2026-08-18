# M7-D-001 代码审核报告

## 审核范围

- Story：`M7-D-001`
- 阶段：`code-review`
- 审核日期：2026-08-18
- 审核方式：两轮独立只读 Agent 审核，当前会话负责按发现修复并重新验证
- 业务文件：
  - `backend/src/main/java/com/frontierscan/article/ArticleController.java`
  - `backend/src/main/java/com/frontierscan/article/ArticleRepository.java`
  - `backend/src/main/java/com/frontierscan/article/ArticleService.java`
  - `backend/src/test/java/com/frontierscan/article/ArticleReadStatusApiIntegrationTest.java`
  - `backend/src/test/java/com/frontierscan/article/ArticleServiceFilterTest.java`
  - `frontend/src/api/articles.ts`
  - `frontend/src/views/DashboardView.vue`

## 审核发现

| 严重级别 | 状态 | 文件 | 行 | 发现 | 关闭措施 |
| --- | --- | --- | --- | --- | --- |
| BLOCKER | resolved | `frontend/src/views/DashboardView.vue` | 543 | 文章阅读状态改变后仍留在不匹配的 `read/unread` 筛选结果中，分页总数不刷新。 | 状态不再匹配当前筛选时重新加载文章页。 |
| WARNING | resolved | `frontend/src/views/DashboardView.vue` | 387 | 筛选请求失败会保留旧结果，并可能产生未处理的 Promise rejection。 | 在列表加载内部处理异常，清空陈旧列表与分页并显示重试入口。 |
| WARNING | resolved | `frontend/src/views/DashboardView.vue` | 358 | 分类、高级筛选和阅读状态请求并发时，旧响应可能覆盖最新结果。 | 使用 `articleRequestId`，只有最新请求可以提交列表、分页和 loading 状态。 |
| WARNING | resolved | `backend/src/test/java/com/frontierscan/article/ArticleReadStatusApiIntegrationTest.java` | 128 | 缺少阅读状态与现有筛选、分页和用户隔离的直接集成测试。 | 增加 `readStatus + categoryId + siteId + keyword + page + size` 组合用例。 |
| WARNING | resolved | `frontend/src/views/DashboardView.vue` | 377 | 最后一页仅剩一篇文章时，文章退出筛选可能留下越界页码。 | 空页且仍有数据时回退到新的最后一页并重新加载。 |

最终独立复审未发现新的 `BLOCKER` 或 `WARNING`。

## 验证证据

- 后端针对性回归：53 个测试通过，0 失败、0 错误、0 跳过。
- 后端全量回归：165 个测试通过，0 失败、0 错误、0 跳过。
- 前端生产构建：`vue-tsc --noEmit` 与 Vite build 通过。
- `git diff --check`：通过。
- 测试选择器：通过 `-ExecutionPolicy Bypass` 正常运行，建议后端测试、前端构建、Harness 结构和任务 DAG 门禁。

## 残余验证缺口

以下内容保留到 `interface-verification` 阶段使用真实浏览器验证：

- `全部/未读/已读` 切换及其与现有筛选、分页的组合。
- 自动标记已读、手动标记已读和手动标记未读后的列表刷新。
- 最后一页仅一篇文章退出筛选后的页码回退。
- 快速连续切换筛选时的旧响应隔离。
- 请求失败及重试反馈。
- 移动端筛选控件布局。

## 结论

审核状态为 `passed`。所有已发现的正确性与测试证据问题均已关闭，可以推进到 `build-publish`；真实交互行为仍需在后续界面验证阶段给出结论。
