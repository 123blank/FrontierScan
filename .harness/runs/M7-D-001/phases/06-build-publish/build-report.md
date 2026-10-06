# M7-D-001 构建报告

## 构建范围

- Story：`M7-D-001`
- 阶段：`build-publish`
- 执行日期：2026-08-18
- 构建类型：本地后端打包与前端生产构建
- 外部操作：未请求、未执行发布、部署、Docker 构建或基础设施修改

## 构建结果

| 构建 | Adapter | 结果 | 关键结论 |
| --- | --- | --- | --- |
| 后端 | `backend-package` | passed | `mvn package` 成功，Maven 汇总 163 个测试通过，产出 Spring Boot JAR。 |
| 前端 | `frontend-build` | passed | `vue-tsc --noEmit` 与 Vite build 成功，转换 110 个模块并产出 `frontend/dist/`。 |

## 产物

- `backend/target/frontierscan-backend-0.1.0-SNAPSHOT.jar`
- `frontend/dist/index.html`
- `frontend/dist/assets/index-457c0310.js`
- `frontend/dist/assets/index-4d1d57b1.css`

这些产物仅保存在本地工作区，未发布到任何外部环境。

## 证据口径说明

代码审核阶段曾直接汇总 `backend/target/surefire-reports/TEST-*.xml` 并得到 165。该目录包含此前定向测试运行遗留的 XML，导致重复计数。当前 `backend-package` Adapter 从完整 Maven 生命周期输出的权威汇总为：

```text
Tests run: 163, Failures: 0, Errors: 0, Skipped: 0
BUILD SUCCESS
```

后续 State 与报告以当前 Adapter 证据中的 163 为准；历史审核证据保持不改写，以保留审计轨迹。

## 结论

后端和前端本地构建均通过，没有发生外部状态变更，可以推进到 `interface-verification`。
