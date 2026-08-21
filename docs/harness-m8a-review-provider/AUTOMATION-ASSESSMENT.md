# FrontierScan Harness M8-A 自动化能力评估

> 日期：2026-08-21
>
> 状态：当前能力说明
>
> 适用范围：真实只读 `code-reviewer` Provider

## 1. 结论

当前 `code-reviewer` 已具备较可靠的独立审核能力，但尚未形成无人干预的自动审核流水线。

```text
审核质量：较好，已具备实际使用价值
自动化程度：中等，调用和返工仍由当前 Codex 会话编排
安全边界：较好，read-only 不是严格文件读取 ACL
```

## 2. 已自动完成的部分

Provider 被调用后，Runtime 能够确定性完成：

- 读取当前 `code-review` task。
- 冻结 task-owned diff、最小上下文、角色策略、Profile 和模型来源。
- 启动真实 `codex exec` 只读审核进程。
- 校验结构化 response、身份、哈希、上下文和仓库完整性。
- 将 finding 映射为 `BLOCKER`、`WARNING` 或 `INFO`。
- 由 Runtime 生成 evidence、审核报告、execution receipt 和 phase result。
- 在超时、非法输出、中断和不可判定执行后按磁盘事实恢复。
- 保证 Agent 不直接修改业务代码、State 或 Git。

真实 M8-A 审核曾发现并推动关闭 12 类身份、模型路由、隔离声明、锁、恢复和超时问题，
最终人工与 Provider 审核均为 `BLOCKER=0`、`WARNING=0`。

## 3. 尚未自动完成的部分

当前 Codex 会话仍需按 Runtime 返回的动作串联：

```text
Prepare -> Run -> Materialize -> Apply
```

当前尚不支持：

- `run-e2e Step` 自动执行完整 Provider 链。
- 自动判断并执行代码修复。
- 自动重试失败或不可判定的 Provider request。
- 自动推进返工后的测试、复审、构建和验收。
- requirement、design、developer、tester 等其他真实 Agent Provider。
- 写入型 Agent、并行、Fork-Join 或自动 Git。

因此，“自动工作”的准确含义是：**审核任务一旦被当前会话明确启动，Agent 可以独立完成
受限审核并返回机器可判定结果；全局流程仍由 Harness Runtime 和当前 Codex 会话共同编排。**

## 4. 当前使用建议

- 将其作为 `code-review` 阶段的正式审核执行器使用，而不是普通文本建议器。
- 保留人工或主会话对有效 finding 的复核和返工决策。
- 不绕过 `Prepare/Run/Materialize/Apply` 的身份、完整性和 result-last 门禁。
- 在 M8-B 完成前，不把审核能力描述为自动业务开发闭环。

## 5. 下一步

M8-B 应接入单任务、单隔离 Worktree、串行的 backend/frontend developer Provider。
M8-B 仍不应自动决定全局流程，也不应提前开放并行或自动 Git。
