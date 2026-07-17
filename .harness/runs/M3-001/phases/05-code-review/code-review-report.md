# Harness M3 最终代码审核报告

## 审核范围

- M2 run 专属产物路径：`state-runtime.mjs`、workflow 和状态测试。
- M3 Dispatcher：`story-runtime.mjs`、`run-story.ps1`、两个 Dispatch Schema 和 M3 测试。
- Harness 集成：结构清单、Smoke、状态校验器、脚本 README 和状态文档。
- 动态证据：`.harness/runs/M3-001/` 的 task、result、checkpoint、adapter evidence 和活动状态。
- 生成知识：Common 指纹、索引和相关状态文档。

## 发现

未发现未解决的 `BLOCKER` 或 `WARNING`。

审核过程中发现并已按 RED/GREEN 修复：

| 原严重级别 | 问题 | 修复与证据 |
| --- | --- | --- |
| BLOCKER | `validate-state.ps1` 用默认代码页读取 UTF-8，中文摘要导致真实活动状态无法校验 | 显式 `-Encoding UTF8`；M2 测试加入中文摘要且活动状态校验通过 |
| BLOCKER | Windows `mvn`/`npm` `.cmd` 不能稳定由原 `execFile("mvn"|"npm")` 直接运行 | 固定 `cmd.exe /d /s /c mvn.cmd|npm.cmd` argv，外层 `shell: false`；平台 argv 测试通过 |
| BLOCKER | `build-publish` 可不运行 build/no-build adapter，结构校验也能误充当构建证据 | 只接受 `backend-package`、`frontend-build` 或 `no-build-required` 作为构建决策；绕过测试通过 |
| BLOCKER | code-review 可借用全局旧 `review.status=passed`，当前 phase 无审核证据仍推进 | 要求当前 `phase=code-review` 的 `review/passed` 记录和匹配 SHA-256；阶段归属测试通过 |
| WARNING | task/checkpoint 合法 JSON 但 workflow 输出集合或 dispatch 身份不匹配时仍被复用 | 增加完整契约比较和失败关闭测试 |
| WARNING | phase 输出只做字符串前缀校验，`../` 归一化后可能离开当前 phase 目录 | 按仓库真实相对路径归一化后再检查，目录逃逸测试通过 |

## 正确性与安全审核

- M2 仍是唯一状态写入和 phase 推进者；M3 没有直接编辑活动状态。
- task/result/checkpoint 核对 Story、phase、dispatch 和 workflow；必需输出必须为当前 phase 内普通文件。
- adapter executable、argv、cwd 和允许 phase 均来自代码内固定 registry；没有任意 shell、Git、发布、部署、PR 或 Worktree 入口。
- unit-test、code-review、build-publish 和 git-delivery 均有不可省略的当前阶段证据门禁。
- 失败 adapter、失败测试、未解决 `BLOCKER`、缺失/变化审核证据和缺失用户批准均不能推进。
- record 后中断重试会比较证据 SHA-256，避免重复记录或复用已变化证据。
- 九阶段 fixture 在每阶段重新读取状态，最终只在 fixture 用户批准存在时完成；已完成 phase 不会重新派发。

## 验证证据

- `story-runtime.test.mjs`：通过。
- `state-runtime.test.mjs`：通过。
- `source-fingerprint.test.mjs`：通过。
- `harness-status.test.mjs`：通过。
- `generate-kb.test.mjs`：通过。
- `kb-query.test.ps1`、`kb-freshness.test.ps1`：通过。
- 结构校验：19 个目录、117 个文件、13 个 Skill。
- 活动状态和任务 DAG 校验：通过。
- 完整 Harness Smoke：通过，Common 查询和 freshness 均为 fresh。
- 知识基线：14 个模块、125 个写入文件、328 个 Chunk；Semantic `pending`、Embedding `skipped`。
- `git diff --check`：无空白错误，仅 Windows 行尾提示。
- `backend/src/**`、`frontend/src/**`：无差异。

## 剩余测试边界

- 未运行真实 Agent Worker、模型调用、工具权限沙箱、超时/取消；属于 M4。
- 未运行多 Story、Worktree 或 Fork-Join；属于 M5。
- 未执行真实发布、部署、API/UI 环境验收、Git 或 PR；属于 M6 且需要用户批准。
- 未做断电级持久化和高并发压力测试；不属于用户要求的基本可用范围，状态写入继续由已验收 M2 锁与原子提交保护。

## 结论

代码审核通过。没有会破坏基本流程、正确性、安全边界或近期合理扩展的未解决问题，可以进入 `build-publish`。
