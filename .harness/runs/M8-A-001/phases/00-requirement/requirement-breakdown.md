# M8-A-001 需求拆解

## 目标

在现有 State v2、Story Runtime 和确定性串行驱动器之上，接入首个真实、非交互、只读的 `code-reviewer` Agent Provider。Provider 通过本机 `codex exec` 执行，只返回严格结构化审核数据，由 Harness Runtime 生成正式 evidence、审核报告和 `result.json`，再交给现有 Story Runtime 投影 State。

同时建立 `Agent role -> Provider Profile -> Adapter/model` 配置契约，使用户可以为不同角色选择模型；M8-A 只实现并开放 `code-reviewer -> codex-cli`，未指定模型时不传 `--model`，如实记录隔离 CLI 的有效默认语义。

## 验收标准

### AC-M8A-REAL-REVIEWER

Harness 能通过固定参数的本机 `codex exec` 启动真实、非交互、`read-only` 的 `code-reviewer`，仅允许当前有效 State v2 `code-review` attempt 调用。

### AC-M8A-MODEL-ROUTING

项目配置、本地覆盖和 Prepare 单次覆盖能够按 `role -> profile -> adapter/model` 解析；模型选择不能改变角色权限、上下文范围、可执行文件或 CLI 参数，未指定模型时不伪造父会话模型继承。

### AC-M8A-ZERO-CONTAMINATION

Provider 不返回 candidate files，不直接写业务代码、State、Git 或正式阶段结果。超时、进程失败、非法响应和完整性违规均失败关闭，State、pointer、events 和正式 report/result 不被污染。

### AC-M8A-RESULT-LAST

成功执行生成唯一 execution receipt；Runtime 按 `evidence -> report -> result.json` 顺序物化，`result.json` 是唯一提交点。中断后可从磁盘事实恢复到 Prepare、Run、Materialize 或 Apply 的唯一下一动作，且不会重复调用模型或产生重复正式记录。

### AC-M8A-COMPARISON-CLOSURE

至少一次真实 task-owned diff 同时完成人工只读审核和 Provider 审核对比；所有有效 BLOCKER/WARNING 被关闭，`M8-A-001` 继续完成后续阶段并进入 `done/completed`，最终 State 和绑定证据可独立回答完整闭环事实。

## 范围内

- `code-reviewer` 的 `codex-cli` Provider 配置、路由、请求、上下文、响应和 execution receipt 契约。
- 固定 argv、隔离临时工作目录、上下文内联、只读写边界和调用前后完整性核对。
- Provider `Status`、`Prepare`、`Run`、`Materialize` CLI 及 E2E 下一动作映射。
- Runtime 生成审核 evidence、Markdown 报告和可由 Story Runtime apply 的阶段结果。
- 严格限定于 `code-review` 的 blocked review payload State 投影。
- fixture、回归、安全审核和一次真实本机 Provider 验收。

## 范围外

- `backend-developer`、`frontend-developer` 或其他写入型 Agent。
- `openai-compatible`、阿里百炼或其他外部 HTTP Adapter 的实现和真实调用。
- Worktree、并行、Fork-Join 和多 Agent 协商。
- 自动修改审核问题。
- 自动执行 Git 暂存、提交、推送、PR、发布或部署。
- 生产环境、云控制面、多租户和严格操作系统级文件读取 ACL。

## 开放问题

无。设计选择和安全边界已在 `docs/harness-m8a-review-provider/DESIGN.md` 中获得批准并通过独立只读复审。
