# M6-A-001 测试报告

## 选择依据

`select-tests.ps1` 根据后端、前端和 Harness 产物变更推荐：

- backend-tests
- frontend-build
- harness-structure

## 执行结果

| 范围 | 命令 | 结果 |
| --- | --- | --- |
| TDD RED | `mvn -Dtest=ArticleReadStatusTest test` | 按预期失败：字段和方法不存在 |
| 定向后端 | `mvn '-Dtest=ArticleReadStatusTest,ArticleReadStatusApiIntegrationTest,UserDataIsolationIntegrationTest' test` | 通过，20 个测试 |
| 完整后端 | `mvn test` | 通过，157 个测试，0 失败，0 错误，0 跳过 |
| 前端 | `npm run build` | 通过，`vue-tsc --noEmit` 与 Vite build 成功 |
| Harness 结构 | `validate-structure.ps1` | 通过 |
| Harness 状态 | `validate-state.ps1 -StateFile .harness/states/e2e-M6-A-001.json` | 通过 |
| 任务 DAG | `validate-task-dag.ps1` | 通过，3 个任务、2 条边、3 个 wave |

## 已覆盖行为

- 已读和未读状态变更。
- 真实 MockMvc + JWT Security Filter 链路下的 PUT/DELETE、未认证拒绝和跨用户 404。
- 状态修改的用户归属校验。
- 收藏文章投影携带 `readAt`。
- 既有后端回归。
- 前端类型和生产构建。

## 剩余验证

- 真实 PostgreSQL 上执行 `V11`。
- 经认证的 HTTP API 调用。
- 看板和收藏页的浏览器交互与响应式布局。

以上项目在后续 build 和 interface-verification 阶段处理。
