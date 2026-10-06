# M7-A2 统一阶段结果与 State 投影实施报告

> 日期：2026-08-12
>
> 基线：`09e80f2 feat(harness): implement M7-A1 state v2 contract`
>
> 状态：实现、fixture 回归与第二轮独立只读代码审核均已通过

## 1. 实施结果

- 新增独立 `dispatch-task v2` 与 `dispatch-result v2` Schema，旧 `1.0/1.1/1.2` 协议保持兼容。
- 九阶段使用严格、判别式 payload；公共元素由 `phase-data-contract.mjs` 在 result 与 State 两端复用。
- 新增纯 `phase-result-projector.mjs`，按阶段完整替换拥有字段，不解析 Markdown 正文。
- v2 task/result/checkpoint 使用 `attempts/<dispatchId>/`，phase 根目录只保存可恢复的 `active-attempt.json`。
- completed apply 在 Story 锁内重读并校验 State、task、result、checkpoint、output、evidence、SHA-256 和 bytes，一次提交投影、证据、正式索引、阶段和 revision。
- `failed` 只更新 attempt 过程状态；`blocked` 通过单次事务写入阻塞状态、证据和 blocked 正式索引，不投影业务 payload。
- 重复 apply 以 `runtime.records[type=phase-result]` 为权威；checkpoint 或 active-attempt 丢失、落后时可恢复，result 漂移失败关闭。
- State v2 手工 `record` 只追加审计记录，不再污染 `tests/review` 的结构化阶段事实。

## 2. TDD 证据

RED 覆盖：

- failed 未同步 active-attempt。
- blocked 多次写 State、缺少正式索引和 resume 新 attempt。
- active-attempt 丢失后无法从正式索引恢复。
- 九阶段数组元素和 State 数组元素接受非法结构。
- 自动 output record 使用错误状态 `present`。
- 新实现资产未进入结构登记。
- `phase-result` 正式索引接受非法 UUID、阶段或倒置 revision。
- task v2 的 `attemptRoot` 未绑定声明阶段。
- 结构化测试结果为 `failed` 时仍可推进。
- State 已提交后，缺失 checkpoint 无法从正式索引恢复。

GREEN 覆盖：

- `phase-result-projector.test.mjs`
- `state-runtime.test.mjs`
- `story-runtime.test.mjs`
- `worker-runtime.test.mjs`

## 3. 独立审核

第一轮独立只读审核发现 4 个 BLOCKER：

1. completed 和 blocked 在 State 提交后无法恢复缺失的 checkpoint。
2. `unit-test` 的结构化 `commands/results` 含 `failed` 时仍可推进。
3. Node State 契约未严格校验 `phase-result` 的 UUID、阶段、ID 绑定和 revision 顺序。
4. task v2 的 attempt 路径未与声明阶段及当前 workflow phase 绑定。

上述问题均按 TDD 修复并增加回归测试。第二轮独立只读审核结论为：

```text
无 BLOCKER/WARNING，建议 M7-A2 通过独立审核。
```

## 4. 验证结果

- `phase-result-projector.test.mjs`：通过。
- `state-runtime.test.mjs`：通过。
- `story-runtime.test.mjs`：通过。
- `worker-runtime.test.mjs`：通过。
- `worktree-lifecycle-runtime.test.mjs`：39/39 通过。
- `worktree-worker-runtime.test.mjs`：全量运行在 15 分钟工具上限前连续通过前 81 项；超时点后的尾部定向用例 17/17 通过，无失败证据。
- `smoke-harness-flow.ps1`：通过。
- `validate-structure.ps1`：通过，检查 34 个目录、234 个文件和 13 个 Skill。
- 三个 M7-A2 Schema JSON：解析通过。
- `git diff --check`：通过，仅有现有 LF/CRLF 提示。

## 5. 架构边界

本阶段没有实现验收项跨阶段引用门禁、accepted gap/stale 批准有效性、owned files 自动推导、交付回执、真实 Agent、并行、Docker 或 Git 自动写入。这些仍按 M7-A3、M7-A4、M7-C 和后续里程碑推进。

## 6. 残余风险

- `worktree-worker-runtime.test.mjs` 尚未在当前工具时限内获得一次完整自然结束的全量结果；已有前 81 项和尾部 17 项通过证据。
- checkpoint 和 `active-attempt.json` 可从正式索引恢复；task/result 文件自身丢失不属于 M7-A2 的过程状态恢复承诺。
- 知识新鲜度仍为 stale-or-incomplete；本阶段只如实记录，不将其错误描述为 fresh，闭环由 M7-C 完成。

## 7. 下一步

M7-A2 已完成。下一子里程碑为 `M7-A3：验收追踪与语义门禁`，启动前先完成专项设计和用户批准。
