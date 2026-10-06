# M7-D-001 返工测试报告

## 结论

返工后的业务代码与 Harness Runtime 定向测试全部通过。

## Harness Runtime

- `harness-state-tests`：通过，覆盖受限 rework、State 原子更新、owner supersession 和既有 State 回归。
- `harness-m3-tests`：通过，覆盖 rework 版本化阶段输出、Story Runtime、result apply、恢复和门禁回归。

## 后端

执行：

```text
mvn test
```

结果：

```text
Tests run: 163, Failures: 0, Errors: 0, Skipped: 0
BUILD SUCCESS
```

覆盖阅读状态筛选、非法参数、组合筛选、分页和用户数据隔离。

## 前端

执行：

```text
node --test tests/readStatusFilter.test.ts
```

结果：2 个测试全部通过。活动 `read/unread` 筛选下每次成功修改阅读状态都会重新加载列表，`all` 筛选不会产生额外加载。

执行：

```text
npm run build
```

结果：`vue-tsc --noEmit` 与 Vite 生产构建通过。

## 验收覆盖

- `AC-READ-FILTER-1`：后端未读筛选测试通过。
- `AC-READ-FILTER-2`：后端已读筛选测试通过。
- `AC-READ-FILTER-3`：组合筛选、分页和默认 `all` 回归通过。
- `AC-READ-FILTER-4`：非法参数与用户隔离测试通过。
- `AC-READ-FILTER-5`：前端构建与阅读状态往返刷新 helper 测试通过。

真实 Chrome 交互将在新的 interface-verification 阶段重新记录。
