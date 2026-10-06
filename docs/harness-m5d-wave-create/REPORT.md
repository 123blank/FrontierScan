# Harness M5-D-B 审批门控 WaveCreate 报告

> Story：`M5-D-B-001`
>
> 范围：Harness Worktree Runtime、PowerShell 入口、Schema、测试、结构登记和中文文档。
>
> 交付状态：实施、测试、最终 Review、构建判定和接口验证判定均已完成；2026 年 8 月 6 日用户已明确批准本次本地 Git 提交，Harness 状态随该批准收口。

## 需求覆盖

| 目标 | 实现 |
| --- | --- |
| 计划审批绑定 | 每个明确 wave 必须同时提供 `ConfirmWaveCreate` 与当前 `plan.json` 的 `ExpectedPlanSha256` |
| 普通创建 | 按计划稳定顺序创建或挂载 `branch-only/absent` 项，`created` 项只复核 |
| 波次锁 | 同一 run/Story 的 wave 共享 `waves/create.lock` 与 `waves/create-recovery.lock`，均包含随机 `lockId` |
| 遗留锁恢复 | 不按时间/PID 自动失效；恢复绑定全部现存锁哈希并要求用户确认旧进程停止 |
| 所有权 fencing | 每次 Git、状态、回执和释放动作前验证当前锁；恢复锁出现后旧所有者失权 |
| 部分失败 | 保留已创建 Worktree，只重试缺失项，不自动回滚 |
| 完成证据 | Git 事实完整为 `ready` 后写绑定计划、DAG、稳定状态和任务 HEAD 的回执 |
| Story 边界 | 同一 Story 其他 wave 和计划外 Worktree 均失败关闭 |

## TDD 与恢复场景

专项测试覆盖审批缺失、错误计划哈希、锁事实、正常创建、脏主树、其他 Story/wave Worktree、计划 TOCTOU、
同 wave 与跨 wave 并发取锁、双恢复并发、恢复写前锁集合变化、恢复 owner 替换、Git/状态/释放点 fencing、
陈旧 WaveStatus 与完成回执并发、恢复再次中断、部分失败、状态写入中断、回执写入中断、PowerShell 参数契约和既有
M5-D-A 漂移校验。所有真实 Worktree 创建均位于测试临时 Git fixture。

## 当前验证

- wave 专项：34/34。
- 单任务/批次 Worktree Runtime：28/28。
- Worktree Worker：54/54。
- Worktree 集成：44/44。
- Worktree 生命周期：37/37。
- batch Runtime：32/32；serial batch：1/1。
- M3 Story、M2 State、Harness 状态摘要和 Task DAG 回归通过。
- 结构校验通过：29 个目录、188 个必需文件、13 个 Skill。
- 非破坏性 Harness Smoke 通过。
- backend/frontend/common 知识 baseline 与 index 均为 fresh，semantic pending 符合预期。
- 当前活动状态校验与 `git diff --check` 通过；后者仅报告 Windows 行尾转换提示。

## Review

首次独立只读 Agent Review 给出 `reject`，发现恢复异常误清锁、恢复接管 owner 竞态、跨 wave 独立锁和实际 Git/状态
写入点 fencing 四个 `BLOCKER`。第二轮复审继续发现恢复写前未重验完整锁集合，以及普通 WaveStatus 可覆盖回执绑定状态
两个 `BLOCKER`；两轮均包含报告覆盖高估 `WARNING`。上述问题均通过 RED-GREEN 修订并更新报告。

第三轮最终复审未发现未解决的 `BLOCKER/WARNING`，结论为 `accept-with-notes`。唯一 `NOTE` 是普通 JSON 文件锁
不是 OS 级租约；遗留锁恢复仍依赖用户真实确认旧创建和恢复进程均已停止。该边界与已批准设计一致。

## 正式仓库证据

- 当前分支基线为 `853e2c69549f17b4d069159c2a8567d2549fa99c`。
- 正式仓库未执行 `WaveCreate`、其他 Worktree 创建/回收、merge、分支删除或 `git worktree prune`。
- 未执行 `git add`、`git commit`、`git push`、PR、发布或部署。
- `CODEX-CROSS-SESSION-HANDOFF.md` 为无关未跟踪文件，未修改或纳入本 Story。

## 剩余边界

- 不启动同 wave Worker，不执行跨 Worktree 结果汇总或自动集成。
- 不提供 wave 回收、自动 merge/remove、Fork-Join、分支删除或 `prune`。
- 不实现 OS 级租约锁；恢复安全依赖用户对旧进程已停止的真实确认。
- 不实现真实 Agent、真实模型、发布、部署或 Git 自动交付。
