# FrontierScan Harness M7-B 最小确定性串行驱动器实施报告

> 日期：2026-08-13
>
> 实施基线：`fe210dc feat(harness): implement M7-A4 delivery semantics`
>
> 状态：实施、验证与独立只读代码审核完成，无 BLOCKER/WARNING

## 1. 完成内容

M7-B 已增加统一串行入口：

```powershell
.\.harness\scripts\run-e2e.ps1 -Command Status -Json
.\.harness\scripts\run-e2e.ps1 -Command Step -Json
.\.harness\scripts\run-e2e.ps1 -Command Apply -Json
```

实现边界：

- `Status` 只读返回唯一下一动作。
- `Step` 一次最多执行一个 `prepare` 或 `apply`。
- `Apply` 只在当前 result 或恢复候选经过完整校验后执行。
- 认知任务返回 `cognitive-action-required`。
- 必需 Adapter 未满足时返回 `adapter-selection-required`，不自动选择命令。
- verification gap 缺少正式批准时返回 `approval-required`。
- blocked、failed 和 completed 均返回明确动作，不伪造推进。

## 2. Story Runtime inspection

`run-story.ps1 -Command inspect` 提供只读 inspection，并复用现有严格契约校验：

- State v2、workflow、task、checkpoint 和 result identity。
- output、record 和 Adapter evidence 路径、SHA-256 与内容。
- required Adapter 门禁及已通过 Adapter 状态。
- required/optional `accepted-with-known-gaps` 的正式 approval receipt。
- State 已推进但 checkpoint 未收尾的恢复候选。
- blocked resume 后旧 attempt 与当前 revision 的隔离。

驱动器不直接读取私有 attempt 文件，因此没有形成第二套 result 或 approval 协议。

## 3. TDD 记录

按 RED-GREEN 实施：

1. `inspect` 未注册，Story Runtime 测试按预期失败。
2. 实现未准备、等待认知、Adapter 门禁和 result ready inspection。
3. 跨阶段恢复测试先返回错误的 `not-prepared`，随后抽取只读恢复检查。
4. optional gap 测试验证缺批准时返回 `approval-required`。
5. Adapter evidence 漂移测试先未被拒绝，随后提取共享 evidence 校验。
6. E2E Runtime 测试因模块缺失失败，随后实现动作映射与单步执行。
7. PowerShell CLI 测试因入口缺失失败，随后增加薄入口。
8. 九阶段纵向 fixture 接入 `runE2ECommand Step` 后发现历史 completed attempt 和 blocked resume 两个判定问题，修复后通过。

最终独立代码审核第一轮发现 3 个 BLOCKER 和 1 个 WARNING，均已修复并增加回归：

1. completed result 增加共享只读 preflight，复用投影、阶段门禁、结构化 evidence、delivery 和 completion gate；不可应用的 result 返回 `result-invalid`，不再循环调用 apply。
2. inspection 与 apply 统一当前 attempt 优先级；当前阶段已有 attempt 时不返回历史 recovery。
3. 任一 Adapter 失败时保持 `adapter-selection-required`，同名 Adapter 重跑成功后才解除失败状态。
4. CLI 测试改为临时 Git 仓库中的真实 PowerShell 子进程调用，覆盖 JSON 成功输出、非法命令、非法参数和 Node 非零退出码传播。
5. 聚焦复审发现 blocked result 被 Adapter readiness 抢先覆盖；现已让 failed/blocked 在结构校验后优先返回，并增加 unit-test 无 Adapter blocked fixture。

## 4. 已通过验证

```text
node .harness/scripts/tests/e2e-runtime.test.mjs
e2e-runtime tests passed

powershell -File .harness/scripts/tests/e2e-cli.test.ps1
e2e CLI tests passed

node .harness/scripts/tests/story-runtime.test.mjs
story-runtime tests passed

node .harness/scripts/tests/state-runtime.test.mjs
state-runtime tests passed

node .harness/scripts/tests/acceptance-gate.test.mjs
acceptance gate tests passed

node .harness/scripts/tests/approval-contract.test.mjs
approval contract tests passed

node .harness/scripts/tests/delivery-runtime.test.mjs
delivery-runtime tests passed

powershell -File .harness/scripts/tests/delivery-cli.test.ps1
delivery CLI tests passed

powershell -File .harness/scripts/validate-structure.ps1
Harness structure validation passed

powershell -File .harness/scripts/smoke-harness-flow.ps1
Harness smoke flow completed

git diff --check
通过，仅有 Git 的 LF/CRLF 提示，无 whitespace error
```

Story Runtime 纵向 fixture 使用统一入口覆盖：

```text
requirement
-> technical-design
-> task-dag
-> implementation
-> unit-test
-> code-review
-> build-publish
-> interface-verification
-> delivery-preparation
-> done
```

fixture 同时覆盖 block/resume、Adapter、逐项 gap approval、交付 manifest、历史证据漂移和完成门禁。

## 5. 安全边界

本阶段未实现或执行：

- 真实 Agent Provider。
- 自动生成业务代码、Markdown 或 result。
- 任意 shell。
- 自动 Adapter 选择。
- Git 暂存、提交、推送或 PR。
- Worktree、并行、Docker、发布或部署。
- knowledge stale 刷新和 `accepted-stale`。

知识检查仍为 `stale-or-incomplete`，属于 M7-C，不在本阶段伪装为已关闭。

## 6. 后续工作

- M7-B 已通过结构、State、approval、smoke、差异检查和最终独立只读代码审核。
- M7-B 提交后进入 M7-C 知识新鲜度闭环。
- M7 整体真实业务验收仍由 M7-D 完成。
