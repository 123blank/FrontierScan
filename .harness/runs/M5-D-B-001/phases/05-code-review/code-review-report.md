# M5-D-B-001 代码评审报告

## 范围

- Story：`M5-D-B-001`
- 评审对象：本 Story 的 Harness Worktree Runtime、PowerShell 入口、Schema、专项测试、结构登记和相关中文文档。
- 评审方式：独立只读 Agent 分三轮检查 task-owned diff；每轮发现均先补充可复现测试，再修订实现并重跑受影响门禁。
- 最终结论：`accept-with-notes`

## 最终发现

未发现未解决的 `BLOCKER` 或 `WARNING`。

| 严重级别 | 文件 | 行 | 发现 | 必需动作 |
| --- | --- | --- | --- | --- |
| NOTE | `.harness/scripts/lib/worktree-runtime.mjs` | 844、912 | wave 锁由仓库内普通 JSON 文件及原子替换实现，不是操作系统级租约；遗留锁恢复仍依赖用户真实确认旧创建/恢复进程均已停止。 | 保持当前显式恢复审批、全部现存锁哈希绑定与 `lockId` fencing；不得按 PID 或时间自动回收锁。 |

## 三轮评审记录

### 第一轮

结论为 `reject`，发现四个 `BLOCKER`：

1. 恢复异常可能进入无条件清理路径并误删锁。
2. 恢复锁替换后未确认磁盘 `lockId` 属于本次调用。
3. 不同 wave 使用独立锁，无法阻止同一 Story 的并发起步。
4. Git 分支探测后及状态实际写入点缺少最后一次计划与 owner fencing。

以上问题均通过新增 RED 用例、修订实现和专项回归关闭。

### 第二轮

结论为 `reject`，继续发现两个 `BLOCKER`：

1. 恢复在实际替换锁之前没有重新校验完整的现存锁集合。
2. 普通 `WaveStatus` 可将陈旧观察结果持久化并覆盖完成回执绑定的稳定状态。

修订后，恢复写前会重验全部现存锁；复用 `WavePlan` 与普通 `WaveStatus` 只返回动态事实，不再持久化观察结果。

### 第三轮

最终复审未发现未解决的 `BLOCKER` 或 `WARNING`，结论为 `accept-with-notes`。唯一保留事项是普通文件锁不提供 OS 级租约语义，恢复安全继续依赖用户对旧进程已停止的真实确认。

## 测试缺口

- 未在正式仓库执行 `WaveCreate`；这是批准边界要求，不是遗漏。所有 Git Worktree 写入均在临时 fixture 中验证。
- 未执行 backend、frontend、API 或 UI 测试；本 Story 未修改业务接口、页面或业务代码。
- 未验证 OS 级租约锁，因为本设计明确不实现该能力。

## 证据

- wave 专项：34/34。
- 单任务 Worktree Runtime：28/28。
- Worktree Worker：54/54。
- Worktree 集成：44/44。
- Worktree 生命周期：37/37。
- batch Runtime：32/32；serial batch：1/1。
- Story、State、Harness 状态摘要、Task DAG、结构、Smoke、知识新鲜度和 `git diff --check` 门禁通过。
- 正式仓库未执行 Worktree 创建/回收、Git 写入、发布或部署。

## 总结

实现符合已批准的方案 A、安全边界和验收标准，可以进入后续非发布构建判定与接口验证判定阶段。
