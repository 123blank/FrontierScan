# M8-A 人工代码审核

## 审核结论

```text
BLOCKER=0
WARNING=0
```

当前 task-owned diff 符合 M8-A 设计和当前阶段安全边界，允许在本机 Codex CLI 登录完成后进入真实 Provider 验收。

## 审核范围

- Provider 配置和模型路由。
- request、context、response、execution receipt Schema 与验证函数。
- 冻结上下文、task-owned diff 和知识门禁。
- Codex CLI 固定 argv、隔离目录、环境白名单和秘密脱敏。
- Provider Status、Prepare、Run、Materialize、锁 fencing 和 result-last。
- code-review blocked payload 的 State 投影。
- PowerShell CLI 与 E2E Provider 动作映射。
- Provider、Worker、State/Story 和结构回归。

## 核心核验

### 权限和进程

- 仅开放 `code-reviewer` 与 `codex-cli`。
- 正式 CLI 不接受 Adapter、executable、argv、prompt、context path、timeout 或输出路径覆盖。
- 子进程使用 `shell=false`、`--sandbox read-only`、`--ephemeral` 和 `--ignore-user-config`。
- 只有收到真实 `spawn` 事件和正整数 PID 后才更新锁。
- 环境变量使用白名单，不继承 API Key、云凭据或任意 Token。

### 输入和输出

- request、context、task、State、配置和 output Schema 均绑定 SHA-256。
- Agent 只返回结构化 response，不返回 candidate files。
- Runtime 负责生成 evidence、Markdown 报告和阶段 result。
- 非法 response 只生成失败 receipt，不写正式 responseFile 或 result。
- 敏感键、Bearer、引号配置和 JSON 结构在持久化前脱敏。

### 恢复和污染

- Prepare 的 context manifest 时间绑定 `task.preparedAt`，支持中断后确定性复用。
- Adapter 同步异常、异步 spawn 失败、超时和完整性漂移均生成失败事实。
- Materialize 按 evidence、report、result.json 顺序提交，`result.json` 为最后提交点。
- 重复 Materialize 和 apply 保持幂等。
- Provider Runtime 不直接修改 State。

### E2E 和 State

- 仅在 `code-review/awaiting-result` 查询 Provider Status。
- `Step` 不自动 Prepare、Run、Materialize 或重试。
- E2E 使用 Story Runtime 返回的规范化相对 State 路径。
- BLOCKER/WARNING finding 通过严格 blocked result 在同一 State 事务中投影。

## 测试证据

通过：

- Provider config、contract、context、Codex CLI、Runtime 和 CLI 专项。
- E2E Runtime。
- State/Story、acceptance、knowledge 回归。
- Worker、Worktree Worker 和 wave 回归。
- Harness structure、smoke 和 `git diff --check`。
- 四轮独立只读 Agent 审核，最终 `BLOCKER=0`、`WARNING=0`。

## 残余验收边界

在 `2026-08-19`：

```text
codex --version
codex-cli 0.148.0-alpha.15

codex login status
Not logged in
```

因此尚未执行真实 `codex exec`。真实 CLI 登录态、默认模型、JSONL 输出和实际 read-only sandbox 行为仍需 execution receipt 验收。

`readIsolation=os-user-boundary` 继续表示写入限制与当前用户读取边界，不表示严格文件读取 ACL。
