# Harness M3 技术设计

## 1. 目标与边界

M3 在 M2 状态运行时上增加单 Story 文件式 Dispatcher，打通“读取当前阶段 -> 生成结构化任务 -> 当前 Codex/人工执行 -> 校验结构化结果 -> 记录证据 -> 由 M2 推进或阻塞”的纵向闭环。

M3 不启动真实 Agent，不提供任意命令执行，不创建 Worktree，不执行发布、部署或 Git 写操作。真实模型/Agent Runtime、工具权限沙箱和并发调度属于后续里程碑。

## 2. 架构

```text
run-story.ps1
  -> story-runtime.mjs
     -> runStateCommand()              # M2 唯一状态写入口
     -> e2e-development.yaml           # phase/owner/required outputs
     -> .harness/runs/<storyId>/
        -> phases/<order>-<phase>/
           -> task.json                # 结构化输入
           -> result.json              # 结构化输出
           -> checkpoint.json          # 可恢复应用进度
           -> output.*                 # 阶段必需产物
           -> evidence/*.json          # 命令与验证证据
```

`state-runtime.mjs` 仅增加工作流路径中的 `{runId}` 占位符展开，并让 task DAG 校验器使用展开后的必需产物路径。没有占位符的既有 fixture 和显式状态继续按原路径运行。

## 3. Dispatcher 命令

### `prepare`

- 通过 M2 `status` 读取当前状态，不直接读取或修改状态字段。
- 从工作流获得当前 phase、`owner_agent`、order、必需输出和 next。
- 创建 run 专属 phase 目录、`task.json` 和 `checkpoint.json`。
- 同一 Story/phase 已有有效任务时直接返回原任务，不生成新 `dispatchId`。
- `blocked` 和 `done` 状态不创建任务，并给出明确恢复或结束信息。

### `status`

- 返回 M2 状态摘要以及当前 phase 的 task/result/checkpoint 路径和状态。
- 只读，不创建目录或文件。

### `run-adapter`

- 只接受代码内固定 adapter ID，使用 Node.js `execFile` 参数数组执行，`shell: false`。
- 首版适配器：Harness 状态测试、M3 测试、Harness 结构校验、backend tests、backend package、frontend build 和 no-build-required。
- adapter 明确声明允许 phase；测试类只允许 `unit-test`，构建类只允许 `build-publish`，结构校验可用于两者。
- executable、argv、cwd、stdout、stderr、exit code、开始/结束时间和耗时写入当前 phase 的 `evidence/*.json`。
- `unit-test` adapter 结果自动通过 M2 `record test` 绑定证据；非零退出码保持为失败证据并使命令返回失败。

### `apply`

- 读取当前 `task.json` 和 result JSON，校验 schemaVersion、`dispatchId`、Story、phase、状态和输出路径。
- `outputs` 必须与 task 中的必需输出完全对应，且都是 run 当前 phase 目录内的普通文件。
- `records` 只允许 M2 已支持的 test/review/note 状态，不允许通过 M3 伪造 approval。
- `completed`：补记尚未记录的证据，确认本 phase 最新 adapter 没有失败后调用 M2 `next`；`git-delivery` 调用 M2 `complete`，仍由 M2 强制用户批准证据。
- `failed`：记录提供的失败证据并保持当前 phase。
- `blocked`：要求 reason/owner/suggestedAction，并调用 M2 `block`。
- 结果先写入 phase 目录并把 checkpoint 标记为 `result-received`；若进程在 record 后、next 前中断，再次 `apply` 会识别同路径同状态记录并继续推进，不重复记录。
- `unit-test` 至少需要一个 adapter 结果；`code-review` 需要当前 phase 的 `review/passed` 哈希证据且无开放 `BLOCKER`；`build-publish` 需要 `backend-package`、`frontend-build` 或 `no-build-required` 之一，单独结构校验不能代替构建决策。

## 4. 结构化契约

任务输入至少包含：

```json
{
  "schemaVersion": "1.0",
  "dispatchId": "UUID",
  "storyId": "M3-001",
  "phase": "unit-test",
  "ownerAgent": "unit-tester",
  "preparedRevision": 8,
  "preparedAt": "ISO-8601",
  "expectedOutputs": [".harness/runs/M3-001/phases/04-unit-test/test-report.md"],
  "allowedAdapters": ["harness-state-tests", "harness-m3-tests", "harness-structure"],
  "next": "code-review"
}
```

结果至少包含：

```json
{
  "schemaVersion": "1.0",
  "dispatchId": "UUID",
  "storyId": "M3-001",
  "phase": "unit-test",
  "status": "completed",
  "summary": "针对性测试通过",
  "outputs": [{ "path": ".harness/runs/M3-001/phases/04-unit-test/test-report.md" }],
  "records": []
}
```

JSON Schema 用于公开契约和结构校验；运行时仍执行路径、身份、当前状态、证据哈希和 phase 语义校验。

## 5. run 专属产物

工作流必需产物调整为：

| Phase | 必需产物 |
| --- | --- |
| requirement | `.harness/runs/{runId}/phases/00-requirement/requirement-breakdown.md` |
| technical-design | `.harness/runs/{runId}/phases/01-technical-design/technical-design.md` |
| task-dag | `.harness/runs/{runId}/phases/02-task-dag/task-dag.json` |
| implementation | `.harness/runs/{runId}/phases/03-implementation/implementation-notes.md` |
| unit-test | `.harness/runs/{runId}/phases/04-unit-test/test-report.md` |
| code-review | `.harness/runs/{runId}/phases/05-code-review/code-review-report.md` |
| build-publish | `.harness/runs/{runId}/phases/06-build-publish/build-report.md` |
| interface-verification | `.harness/runs/{runId}/phases/07-interface-verification/interface-verification-report.md` |
| git-delivery | `.harness/runs/{runId}/phases/08-git-delivery/delivery-report.md` |

`.harness/outputs/` 和 `.harness/reports/` 继续作为旧辅助脚本和当前 M3 自举流程的兼容入口；新 M3 运行不把它们作为阶段事实来源。

## 6. 恢复与幂等

- phase 目录按 workflow order 和 phase ID 唯一定位。
- `prepare` 复用当前 phase 已存在且身份一致的任务。
- `apply` 以 task 的 `dispatchId` 和 result 内容为本阶段事务身份。
- 已存在相同 path/type/status 的 M2 记录时跳过 record，随后继续 `next/complete`。
- state 已推进到下一 phase 时，旧 phase result 返回 `already-applied`，不重新派发或回退状态。
- 不处理机器断电级 fsync、多进程高压竞争和通用分布式幂等；M2 现有锁继续保护状态写入。

## 7. 错误与安全

- 任何任务/结果身份不一致、越界路径、符号链接、缺失输出或 adapter phase 不匹配均失败关闭，且不推进状态。
- 任意 adapter 非零退出都会形成可审计失败证据；unit-test 失败由 M2 门禁继续阻断。
- M3 不接受 approval record；批准只能通过现有 `run-state.ps1 record -RecordType approval -Actor user` 入口记录。
- 固定 adapter 列表中没有 publish、deploy、Git、PR 或 Worktree 命令。

## 8. 测试策略

按 TDD 分四个业务闭环：

1. M2 `{runId}` 必需产物路径展开和 DAG 校验路径。
2. `prepare/status` 的结构化派发与任务复用。
3. `run-adapter/apply` 的结果校验、失败/阻塞门禁和中断恢复。
4. 全阶段临时仓库纵向测试，从 requirement 到 delivery summary，覆盖缺失产物、失败命令和 `BLOCKER`。

每个闭环均先观察针对性 RED，再完成最小实现、运行相关回归并进行只读差异审核。最终运行 M2/M3 测试、Harness 结构、状态、DAG、完整 Smoke 和 `git diff --check`。

## 9. 兼容性

- `run-state.ps1` 的公开命令和既有参数保持不变。
- 没有 `{runId}` 的自定义 workflow 继续使用原固定路径。
- M3 不修改业务源码或业务 API。
