# M6-A-001 接口与界面验证报告

## 环境

- API：Spring Boot test profile、H2 内存数据库、真实 `JwtUtil`、Security Filter 与 `MockMvc`。
- UI 构建：`frontend/dist` 已生成。
- 运行态 UI：当前 `docker compose ps` 无服务，`8080`、`5173` 无监听；未获授权启动 Docker、外部 PostgreSQL 或部署环境。

## 验证用例

| Case | 类型 | 操作 | 预期 | 实际 | 结果 |
| --- | --- | --- | --- | --- | --- |
| T1-C1 | API/持久化 | 新建 Article 后读取 `readAt` | `null`，表现为未读 | `ArticleReadStatusTest` 断言通过 | pass |
| T1-C2 | API | owner JWT 调用 `PUT /api/articles/{id}/read`，再调用 DELETE | PUT 返回非空 `readAt`；DELETE 返回空值；重复 PUT 不重置时间 | MockMvc + Service 测试通过 | pass |
| T1-C3 | API/安全 | intruder JWT 调用 owner 文章 PUT | HTTP 404，统一错误响应 | 返回 404，`success=false` | pass |
| T1-C4 | API/投影 | 查询收藏文章视图 | 返回 `readAt` | H2 集成测试投影时间一致 | pass |
| T2-C1 | UI 构建 | 检查看板和收藏卡片绑定 | 显示“已读/未读” | Vue 类型检查与构建通过；源码绑定存在 | pass |
| T2-C2 | UI 逻辑 | 打开未读详情 | GET 成功后调用 PUT 并同步列表 | 代码审核确认 requestId 与同步逻辑正确 | pass |
| T2-C3 | UI 逻辑 | 详情点击“标记未读” | 调用 DELETE 并同步列表 | 代码审核确认，失败可重试 | pass |
| T2-C4 | UI 失败态 | 阅读状态写请求失败 | 保留服务端原状态并显示反馈 | `role="alert"` 错误提示和重试按钮已审核 | pass |
| T2-C5 | 运行态 UI | 桌面/移动浏览器点击流程 | 无重叠且状态可见 | 无运行环境，未启动外部依赖 | blocked |

## 证据

- `ArticleReadStatusApiIntegrationTest`：未认证拒绝、owner PUT/DELETE JSON、跨用户 404。
- `ArticleReadStatusTest`：默认未读、幂等时间、已读/未读、跨用户拒绝。
- `UserDataIsolationIntegrationTest`：收藏投影和用户隔离。
- 后端完整测试：157/157。
- 前端构建：`vue-tsc --noEmit` 与 Vite build 通过。
- 三轮独立代码审核：最终无 BLOCKER/WARNING。

## 诊断与剩余风险

- 未在真实 PostgreSQL 上运行 `V11`；迁移仅包含 PostgreSQL 原生支持的 `add column read_at timestamptz`。
- 未执行真实桌面/移动浏览器点击验证；源码、构建和独立 UI 审核未发现布局或状态同步问题。
- 未启动 Docker、外部数据库、发布或部署环境。

## 结论

后端 API、安全、持久化契约和前端构建/交互逻辑通过。运行态 UI 用例因环境不可用记录为 blocked，不伪造验证结果；该风险不影响代码进入待 Git 批准的交付阶段。
