# M7-D-001 测试报告

## 结论

后端全量测试与前端生产构建均通过。当前阶段证明代码级行为和类型契约满足要求；Dashboard 的真实按钮、请求参数、DOM 结果和分页重置将在 interface-verification 阶段验证。

## 正式命令

### backend-tests

```text
Set-Location backend
mvn test
```

结果：通过，162 个测试，0 失败，0 错误，0 跳过。

证据：

` .harness/runs/M7-D-001/phases/04-unit-test/attempts/c2386147-97b3-44aa-8a49-389660e82825/evidence/backend-tests.json `

### frontend-build

```text
Set-Location frontend
npm run build
```

结果：通过，`vue-tsc --noEmit` 和 Vite build 成功。

证据：

` .harness/runs/M7-D-001/phases/04-unit-test/attempts/c2386147-97b3-44aa-8a49-389660e82825/evidence/frontend-build.json `

## 验收覆盖

| 用例 | 验收标准 | 结果 |
| --- | --- | --- |
| `TC-READ-UNREAD` | `AC-READ-FILTER-1` | 后端 API 集成测试验证只返回当前用户未读文章 |
| `TC-READ-READ` | `AC-READ-FILTER-2` | 后端 API 集成测试验证只返回当前用户已读文章 |
| `TC-READ-COMBINED` | `AC-READ-FILTER-3` | 文章筛选、分页和默认 `all` 回归通过 |
| `TC-READ-ISOLATION` | `AC-READ-FILTER-4` | 非法参数与用户隔离测试通过 |
| `TC-READ-UI-BUILD` | `AC-READ-FILTER-5` | 前端类型检查和构建通过，真实交互待界面验证 |

## 已知边界

- Spring Data `PageImpl` 序列化警告为现有行为，本 Story 未修改分页响应结构。
- 测试日志中的 H2 dialect 与测试安全密码提示为现有测试环境输出。
- 本阶段不将前端 build 描述为真实 UI 已验证。
