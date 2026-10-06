# Harness M3 接口验证报告

## 环境

本次是 Harness CLI/文件协议变更，不涉及 backend API、frontend UI 或部署环境。无需启动产品服务，也没有可调用的业务接口。

## 验证用例

| 用例 | 操作 | 预期 | 实际 | 结果 |
| --- | --- | --- | --- | --- |
| M3-CLI-01 | PowerShell `run-story.ps1 status/prepare` | 可读取活动状态、生成任务并复用 dispatch | 实际 `M3-001` 运行通过 | 通过 |
| M3-CLI-02 | 用 `result.json` 执行 `apply` | 只通过 M2 推进并记录 SHA-256 | implementation、unit-test、code-review、build-publish 均实际推进 | 通过 |
| M3-CLI-03 | 完整 Smoke 临时运行 M2 init/validate 与 M3 prepare/status | 退出 0 且不污染仓库状态 | Smoke 通过，临时目录已清理 | 通过 |
| M3-E2E-01 | 九阶段临时仓库纵向闭环 | 每阶段可重启读取，delivery 批准存在时进入 done | 自动化测试通过 | 通过 |

## 失败诊断

无失败用例。产品 API/UI 环境验证不适用，因为业务源码和业务契约没有变化。

## 证据

- `.harness/runs/M3-001/phases/04-unit-test/test-report.md`
- `.harness/runs/M3-001/phases/05-code-review/code-review-report.md`
- `.harness/scripts/tests/story-runtime.test.mjs`
- `.harness/scripts/smoke-harness-flow.ps1`

## 结论

M3 Harness 接口和纵向流程验收通过，可以进入 git-delivery 摘要阶段。
