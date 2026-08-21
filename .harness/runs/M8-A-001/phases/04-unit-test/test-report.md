# M8-A 测试报告

## 结论

M8-A Provider 专项、E2E、State/Story、Worker、结构和 smoke 回归全部通过。

本报告证明实现与恢复协议通过本地测试，不替代后续真实 `codex exec` execution receipt。

## Provider 专项

通过：

```text
node .\.harness\scripts\tests\provider-config.test.mjs
node .\.harness\scripts\tests\provider-contract.test.mjs
node .\.harness\scripts\tests\provider-context.test.mjs
node .\.harness\scripts\tests\codex-cli-provider.test.mjs
node .\.harness\scripts\tests\provider-runtime.test.mjs
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.harness\scripts\tests\provider-cli.test.ps1
```

覆盖：

- role -> Profile -> adapter/model 路由。
- 项目配置、本地覆盖和 Prepare 单次覆盖。
- request、context、response 和 execution receipt 严格契约。
- 固定 Codex CLI argv、read-only sandbox 和模型参数。
- 环境变量白名单与敏感信息脱敏。
- Prepare、Run、Materialize 锁和中断恢复。
- 失败 response、非法 response、完整性漂移和 result-last。
- WARNING/BLOCKER finding 到正式 result 的映射。

## E2E 与 State

通过：

```text
node .\.harness\scripts\tests\e2e-runtime.test.mjs
node .\.harness\scripts\tests\state-runtime.test.mjs
node .\.harness\scripts\tests\story-runtime.test.mjs
node .\.harness\scripts\tests\acceptance-gate.test.mjs
node .\.harness\scripts\tests\knowledge-runtime.test.mjs
```

覆盖：

- 仅在 `code-review/awaiting-result` 映射 Provider 状态。
- `Step` 不自动 Prepare、Run、Materialize 或重试。
- 规范化 State 相对路径。
- blocked review payload 的原子 State 投影。
- 九阶段 Story fixture 与 M7-D 六个场景。

## Worker 与结构回归

通过：

```text
node .\.harness\scripts\tests\worker-runtime.test.mjs
node .\.harness\scripts\tests\worktree-worker-runtime.test.mjs
node .\.harness\scripts\tests\worktree-wave-execution-runtime.test.mjs
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.harness\scripts\validate-structure.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.harness\scripts\smoke-harness-flow.ps1
git diff --check
```

`worktree-worker-runtime` 的 93 项测试均在当前工作区通过；由于 Windows 临时 Git fixture 总时长超过单次命令预算，采用连续区段与名称过滤补齐，没有失败项。

## 正式 Adapter 记录

`harness-state-tests` Adapter 已于 `2026-08-19T07:31:07.735Z` 完成，退出码为 `0`：

```text
M7D-SCENARIO:block-resume:passed
state-runtime tests passed
```

证据：

```text
.harness/runs/M8-A-001/phases/04-unit-test/attempts/31fed40d-84c1-4967-acae-ee55eed442b0/evidence/harness-state-tests.json
```

## 剩余外部验收

本机 `codex --version` 可执行，但 `codex login status` 在 `2026-08-19` 返回 `Not logged in`。

因此真实 Provider Run 必须等待本机 Codex CLI 登录完成；该事实不影响本地测试通过，但阻止真实 execution receipt 验收。
