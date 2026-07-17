# Harness M3 代码审核报告

## 审核范围

- `validate-state.ps1` 与活动指针状态门禁。
- `story-runtime.mjs` 的固定 adapter 子进程输出处理。
- `validate-structure.ps1` 与 Dispatch Schema JSON 校验。
- `story-runtime.mjs` 的 no-build 差异门禁和推进后 checkpoint 对账。
- `.gitignore` 与 `summarize-delivery.ps1` 的运行态交付边界。
- 对应 M2/M3 回归测试和 M3 使用说明。

历史 phase 5 证据保留在 `.harness/runs/M3-001/phases/05-code-review/code-review-report.md`，本次未改写该文件，避免破坏状态记录中的 SHA-256。

## 已关闭问题

| 原问题 | 修复 | 直接证据 |
| --- | --- | --- |
| `active-run.json` 使推荐状态门禁失败 | 统一状态校验器识别并校验活动指针 | 合法指针通过、路径错配和字段类型错误失败；全目录状态命令退出 0 |
| adapter 输出超过 Node.js 默认 1 MiB 时被误判失败 | stdout 和 stderr 各使用 16 MiB 有界缓冲 | 2 MiB 真实子进程输出完整写入证据并通过 |
| Dispatch Schema 只检查存在性 | 两个 Schema 纳入 `Assert-Json` | M3 测试检查结构校验契约，结构门禁实际解析 JSON |
| PowerShell wrapper 省略 `-Root` 时默认路径解析失败 | 在脚本正文基于 `$PSScriptRoot` 解析默认根目录 | `run-state.ps1` 和 `run-story.ps1` 的真实入口回归及当前仓库命令均通过 |
| `build-publish` 只信任 checkpoint 中的 adapter 字段 | checkpoint 绑定 evidence SHA-256，`apply` 重验普通文件、哈希、派发身份和退出状态 | adapter 通过后篡改 evidence 的回归先 RED，修复后拒绝推进并保持当前 phase |
| phase 4/5/6 证据早于最终门禁修复 | 在 `git-delivery` 新增最终验证报告并重新绑定最新测试、审核和核心文件哈希 | 完整 Harness 回归重新退出 0；历史证据保留且不再被表述为最终工作区的唯一依据 |
| `no-build-required` 无条件成功 | 固定执行 backend/frontend Git 状态检查，发现 staged、unstaged 或 untracked 变化时保存失败 evidence | 脏范围 RED/GREEN、干净范围和当前真实工作区检查均通过 |
| M2 已推进、checkpoint 未落盘时重试失败 | 使用 `runtime.previousPhase`、workflow next 和旧派发身份对账，补齐 checkpoint 并返回 `already-applied` | 状态先推进、checkpoint 保持 `result-received` 的故障注入 RED/GREEN 通过 |
| 本机活动状态可能进入 Git 交付 | `.gitignore` 排除活动指针、E2E 状态、备份、临时文件、锁和事件日志；交付分类器将 `.gitignore` 纳入 owned | Git ignore 正反例和 delivery summary 均通过，模板与 run 证据仍可交付 |

## 结论

未发现未解决的 `BLOCKER` 或 `WARNING`。M1/M2/M3 测试、Harness Smoke、结构、状态、DAG、知识回归、no-build 真实范围检查和差异检查均通过；`backend/src/**` 与 `frontend/src/**` 无差异。

16 MiB 是当前有意的有界输出限制。超过该范围的超大日志仍会失败关闭，属于 M3 当前阶段可接受的资源边界，不影响常规 Maven/npm 门禁。
