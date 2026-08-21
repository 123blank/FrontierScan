# FrontierScan Harness M8-A 只读审核 Agent Provider 实施报告

> 日期：2026-08-19
>
> 状态：已完成
>
> 设计：`docs/harness-m8a-review-provider/DESIGN.md`
>
> 计划：`docs/harness-m8a-review-provider/PLAN.md`
>
> Story：`M8-A-001`

## 1. 完成范围

M8-A 在 State v2 和确定性串行驱动器之上接入了首个真实、只读
`code-reviewer` Provider：

```text
E2E Runtime
-> Provider Prepare
-> 冻结 request/context/policy/profile/model
-> codex exec read-only
-> execution receipt 与完整性核对
-> Runtime Materialize
-> Story Runtime Apply
```

本阶段同时建立了 `role -> profile -> adapter/model` 配置层。项目默认配置可提交，
本地覆盖被 Git 忽略，密钥不进入配置、State、日志或回执。

## 2. 主要实现

- 新增 Provider 配置 Schema、项目默认配置和确定性覆盖优先级。
- 新增 request、context、response 和 execution receipt 严格契约。
- 新增有界冻结上下文、知识门禁、task-owned diff 和 `reviewTargets`。
- 新增固定 argv 的 `codex-cli` Adapter、超时终止、JSONL 解析和诊断脱敏。
- 新增 Provider `Status/Prepare/Run/Materialize` Runtime、共享锁和 result-last 恢复。
- 新增 claim-first 执行防重与 claim-only 不可判定恢复：原 request 禁止重跑，显式
  `Materialize` 只生成 Runtime evidence 和 blocked result。
- 新增 `run-provider.ps1`，并将 Provider 状态映射到 E2E 唯一下一动作。
- 新增严格限定于 `code-review` 的 blocked finding State 投影。
- 保持 M4/M5 Mock Worker、State v2、phase result v2 和 Git 安全边界兼容。

## 3. 模型路由语义

配置优先级为：

```text
Prepare 单次覆盖
-> agent-providers.local.json
-> agent-providers.json
-> 内置 codex-default
```

`model=null` 表示 Runtime 不传 `--model`，不虚构继承父 Codex UI 会话的临时模型。
需要固定模型时必须显式配置。

真实验收使用本地 Profile：

```text
profile=codex-custom
adapter=codex-cli
requestedModel=gpt-5.6-sol
resolvedModel=gpt-5.6-sol
modelSource=local-config
```

本地配置不含 API Key，也不进入交付文件。

## 4. 真实 Provider 验收

最终成功执行：

```text
dispatchId=19cd43d7-1d4e-4e02-89ed-a8079a8a8ccb
providerRequestId=a5025528-930c-4820-b726-7fc66fd900a5
providerExecutionId=cab18d21-f92b-4c8b-a8f3-d0706e72c7ab
exitCode=0
status=completed
```

完整性结论：

- `repository-snapshot=passed`
- `isolated-root=passed`
- `readIsolation=same-os-user-readonly-sandbox`
- Agent 未返回 candidate files。
- 正式 evidence、审核报告和 result 由 Runtime 生成。
- 最终 Provider 审核无 `BLOCKER`、`WARNING` 或 `INFO` finding。

## 5. 人工与 Provider 审核对比

人工审核在真实调用前确认固定 argv、上下文边界、零污染、恢复和 State 投影设计。
真实 Provider 在多轮执行中发现并推动关闭了以下实际问题：

1. prompt 未包含随机 `providerRequestId`。
2. 同值显式模型覆盖会丢失 `runtime-override` 来源。
3. receipt 错误声称操作系统用户隔离。
4. blocked Materialize 写固定报告，阻断后续重审。
5. timeout 与 `close` 存在竞态，超时可能被误记为普通失败。
6. Provider lock 检查后删除存在竞争，可能删除新持有者的锁。
7. 冻结 request 缺少独立完整性绑定。
8. 删除文件 baseline 未按原始字节执行 UTF-8 和大小门禁。
9. 父进程崩溃可能对同一冻结 request 重复调用模型。
10. claim-only 防重修复缺少正式收口路径，可能永久搁置 active attempt。
11. 恢复路径未重新对账 response 与冻结 request 身份，协调修改 response 和 receipt 可绕过绑定。
12. stdout/stderr 超限终止依赖 child `close`，可能等满总超时并误分类为 `timed-out`。

第 10 项采用显式不可判定恢复：`execution-claim.json` 保持不可变，不伪造 receipt，也不重跑
原 request；Runtime 生成独立 evidence 和 blocked result，apply/resume 后由全新 attempt 继续审核。

第 11 项在磁盘恢复读取时重新核对 request、dispatch、Story、run、phase 和 role 六项身份；
协同修改 response 与 receipt 的 fixture 已证明漂移会进入 `provider-invalid`。

第 12 项让 output-limit 独立 settle 并等待进程树终止完成，不依赖 `close` 事件；持续打开的
fixture 能在总超时前返回 `invalid-response`。

这些 finding 均增加复现测试、完成最小修复并重新执行人工与 Provider 审核。最终两类审核均为：

```text
BLOCKER=0
WARNING=0
```

## 6. 测试与验证

已通过：

- Provider config、contract、context、Codex CLI、Runtime 和 PowerShell CLI 专项测试。
- State、Story、E2E、acceptance 和 knowledge Runtime 回归。
- Worker 与 Worktree wave 回归。
- Harness 结构校验、smoke 和 `git diff --check`。
- 五项 required criterion 的结构化 `manual-harness` 验收。

`worktree-worker-runtime.test.mjs` 的完整单进程套件曾因总耗时超过 7 分钟被外层命令终止，
可见子测试持续通过；M8-A 未修改该模块。受影响的
`worktree-wave-execution-runtime.test.mjs` 为 9/9 通过。

本 Story 不修改业务 API 或 UI，因此浏览器和 HTTP 业务验证不适用；没有把未执行的 UI
验证伪装为通过。

五项 required criterion 均为 `verified`。最终 State 为：

```text
phase=done
runtime.status=completed
runtime.revision=51
delivery.status=ready
delivery.gitStatus=not-requested
```

`verify-story-closure.ps1` 仅读取最终 State 和绑定证据即可复核需求、设计、DAG、实现、
测试、审核、构建、验收与交付准备事实。

## 7. 知识与交付归属收口

最终知识新鲜度检查结果：

```text
backend=fresh
frontend=fresh
common=fresh
semantic=pending
```

M8-A 只修改 Harness 和文档资产，不需要重新生成业务知识。`llm-knowledge/overview.md`
已同步真实 Provider 能力和边界，`custom/` 未被修改。

`PLAN.md` 在 Story 初始化前已经是 dirty，Story 期间又按要求持续勾选。State 没有保存
初始化时的文件字节快照，无法安全拆分前后修改。Delivery Runtime 正确拒绝把该路径同时
作为 initial dirty 和 actual file。

独立审核后采用既有受限 late-stage rework：

- 不修改 M7-A4 initial dirty 协议。
- 不追溯修改 baseline。
- 不把 `PLAN.md` 伪造成 owned。
- 新 implementation 将其排除并由 delivery 如实列为 unrelated。
- implementation 之后的测试、Provider 审核、构建和验收全部重新执行。
- 最终 owned manifest 只包含 M8-A 的配置、Schema、Runtime、测试、报告和同步文档；
  `gitStatus=not-requested`，未执行暂存、提交或推送。

## 8. 安全边界

M8-A 未实现：

- backend/frontend 开发 Agent。
- `openai-compatible` 或阿里百炼 HTTP Adapter。
- candidate files 或主树写入。
- Worktree、并行或 Fork-Join。
- 自动 Git、PR、发布或部署。
- 严格操作系统级读取 ACL。

`read-only` 只说明同一操作系统用户下的写入限制。需要严格读取隔离时，必须另行设计不同
用户、容器或等价文件系统沙箱。

## 9. 下一步

下一阶段是 M8-B 专项设计：只开放单任务、单隔离 Worktree、串行的 backend/frontend
developer Provider。开始前仍需用户批准，不提前开放写权限、并行或自动 Git。
