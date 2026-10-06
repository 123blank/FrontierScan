# FrontierScan Harness M4-B 受约束 Mock Worker 设计

> 日期：2026-07-17
> Story：`M4-B-001`
> 状态：实施中

## 1. 目标与边界

M4-B 在 M3 `prepare` 和 `apply` 之间增加受约束 Worker。Worker 读取既有 `task.json`，根据独立角色策略构造有界上下文，通过测试注入的 mock provider 获得候选文件和 M3 `result.json`，全量校验后先写阶段产物、最后写结果。M2/M3 仍是唯一状态、Adapter、证据门禁和 phase 推进者。

本 Story 不启动真实 Codex Agent，不提供 mock CLI，不调用真实模型，不授予 shell、网络、Git、发布、部署或状态命令，也不修改 `backend/src/**`、`frontend/src/**` 的实际业务文件。

## 2. 内部接口

```js
runWorkerTask({
  root,
  taskFile,
  provider,
  timeoutMs = 30_000,
  contextFiles = []
})
```

Provider 接收 `{ task, policy, context, signal }`，返回 `{ files, result }`。候选文件项固定为 `{ path, content, capability }`。`contextFiles` 只允许显式仓库相对普通文件，不扫描目录。

单文件上限为 2 MiB；task、角色策略和 context 合计不超过 8 MiB；候选文件和序列化结果合计不超过 8 MiB。timeout 必须大于 0 且不超过 30 秒。

## 3. 契约和权限

M3 task/result Schema 保持 `1.0`。共享 Dispatch 结构校验器负责 JSON Schema 可表达的字段、类型、枚举、唯一性和额外字段约束；M3 继续负责当前状态、workflow、证据和 phase 语义。

`.codex/agents/worker-policies.json` 为 12 个角色声明读路径、写路径和固定 capability。运行时从 `agents.yaml` 读取名称与类别，要求两个注册表一一对应。能力只有：

- `phase-output`：当前 task 的 `expectedOutputs`。
- `backend-write`：`backend/src/`。
- `frontend-write`：`frontend/src/`。
- `backend-test-write`：`backend/src/test/`。

不存在任意命令、网络、状态推进、发布或 Git 能力。候选路径必须同时满足角色写前缀和能力内建边界；planning、test-case-designer、interface-verifier、code-reviewer、publisher 和 git-committer 只能生成当前 phase 必需产物，unit-tester 还可按策略写入 `backend/src/test/`。

## 4. 数据流和失败语义

```text
M3 prepare
  -> task.json
  -> Worker 校验 task、策略、context 和 provider 返回
  -> 全部候选写临时文件
  -> rename 阶段产物
  -> 最后 rename result.json
  -> 调用方显式执行 M3 apply
  -> M2 record/next/block/complete
```

策略、上下文、provider、身份、Schema、路径、capability、输出集合或大小任一校验失败时，不写候选文件和 `result.json`，也不调用 M2/M3。产物写入后中断且 `result.json` 不存在时，调用方可使用同一 dispatch 显式重试并覆盖候选产物；结果已经存在时必须转入 M3 `apply` 或人工检查，Worker 会在调用 provider 前拒绝重复执行。

## 5. 稳定性边界

同进程 mock provider 是依赖注入测试边界，不是针对恶意本地代码的操作系统安全边界。真实 Agent 接入需要后续结合 Codex custom agent、sandbox 和权限配置复验。断电级 fsync、多文件全局事务、并发 Worker 和自动清理遗留临时文件不在 M4-B 范围。
