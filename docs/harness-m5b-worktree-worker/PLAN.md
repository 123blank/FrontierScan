# Harness M5-B1 Worktree 内 Worker 执行与结果回收实施计划

## 1. 实施原则

- 单 Story：`M5-B1-001`。
- 先保存需求、设计和 DAG，再开始实现。
- 每个任务严格执行 RED -> GREEN -> REFACTOR -> 范围审核，通过后才进入下一任务。
- 只组合现有 M3、M4-B、M5-A 能力；不提前实现 M5-B2。
- 测试只在临时 Git 仓库创建 Worktree；不在 FrontierScan 正式仓库创建、合并或删除 Worktree。

## 2. 任务 1：编排契约与前置门禁

### RED

新增 `worktree-worker-runtime.test.mjs`，先覆盖：

- 缺失或无效 state/task/plan/status。
- Worktree 非 `created`、base/HEAD/branch/DAG 漂移。
- 未知 task、非 pending task、DAG 超过一个节点。
- DAG owner 与 M3 task owner 不一致。
- M3 task 的 Story、phase 或 prepared revision 与 active state 不一致。
- 所有失败场景中 Provider 调用次数为 0，state 文件字节不变。

### GREEN

新增最小 `runWorktreeWorker`：复用 `runWorktreeCommand(status)`、`loadTaskDag` 和 dispatch 契约，建立运行目录和独占 `execute.lock`。只实现门禁，不执行 Provider。

### 验证

```powershell
node .\.harness\scripts\tests\worktree-worker-runtime.test.mjs
```

## 3. 任务 2：混合输入快照

### RED

先覆盖：

- task 和当前 run Harness 上下文按相对路径复制并记录 SHA-256。
- 已提交源码/文档直接使用 Worktree base 版本，不复制主工作树版本。
- 非当前 run 的未提交文件、绝对路径、父目录跳转、符号链接、非 UTF-8、单文件 2 MiB 和总量 8 MiB 超限失败。
- 重复或大小写等价 context 路径失败。
- 首次执行 Worktree 存在未识别修改时失败。

### GREEN

实现显式输入分类、受限读取、原子复制和 `input-manifest.json`；新增对应 Schema。输入完整校验后才允许调用 Provider。

### 验证

运行 M5-B1 针对性测试，并确认非法输入不会留下临时文件或调用 Provider。

## 4. 任务 3：Worker 执行与写入集合核验

### RED

先覆盖：

- mock Provider 在 Worktree 根目录收到正确 task、policy 和 context。
- Provider 超时、异常、非法输出不生成成功 receipt，state 不变。
- Worker 修改 `main-run` 输入或未声明为候选的 base 上下文、删除文件、写入策略外路径或产生未识别 Git 差异时失败；通过权限校验并明确声明为候选的 base 上下文允许更新。
- phase output、backend、frontend 写入能被准确分类并记录哈希。

### GREEN

调用现有 `runWorkerTask`，比较执行前后 Worktree Git 事实，复用 Worker policy 判定允许路径。编排层不向 Provider暴露 Git、shell、网络、状态或主仓库绝对路径。

### 验证

```powershell
node .\.harness\scripts\tests\worktree-worker-runtime.test.mjs
node .\.harness\scripts\tests\worker-runtime.test.mjs
```

## 5. 任务 4：分级回收与恢复

### RED

先覆盖：

- 仅 phase output 时，主工作树先得到产物、最后得到正式 `result.json`，返回 `ready-for-apply`。
- `ready-for-apply` 后 state revision 不变；调用方显式 M3 apply 后只推进一次。
- 任一 backend/frontend 写入时，不复制业务文件、不写正式 result，独立保存 `worker-result.json`，返回 `ready-for-integration`。
- phase output 已复制但 result/receipt 尚未写入时可恢复。
- Worker result 已写但主工作树尚无 receipt 时，phase-output-only 可恢复且 Provider 不重复调用；存在无 durable candidate list 的业务写入时失败关闭。
- 已有匹配 receipt 时幂等复用；哈希或身份不匹配时失败关闭。
- 遗留 `execute.lock` 阻止执行且不自动清理。

### GREEN

新增 input manifest 和 execution receipt Schema；实现全量预检、确定顺序的原子复制、正式 result 最后写入、独立 result 证据和恢复分支。

### 验证

运行 M5-B1、M4-B 和 M3 针对性测试，检查临时文件清理及状态不变断言。

## 6. 任务 5：临时仓库纵向闭环

在临时 Git 仓库串联真实组件：

```text
M3 prepare
  -> M5-A plan/create
  -> M5-B1 mock Worker
  -> ready-for-apply
  -> 调用方显式 M3 apply
```

另建业务写入场景：

```text
M3 prepare
  -> M5-A plan/create
  -> M5-B1 mock Worker 写业务代码
  -> ready-for-integration
  -> 主工作树与 state 保持不变
```

断言正式 FrontierScan 仓库没有创建 Worktree，测试 fixture 完成后清理临时目录。

## 7. 文档与结构同步

实现稳定后更新：

- `.harness/scripts/README.md`
- `docs/harness-structure-checklist.md`
- `docs/harness-architecture-adaptation.md`
- `docs/AI-handover.md`
- `llm-knowledge/common/overview.md`（仅在 freshness/范围核验确认需要时）
- Harness 结构校验中的 Schema、脚本、测试和 M5-B1 文档登记

生成 `docs/harness-m5b-worktree-worker/REPORT.md`，记录需求覆盖、RED/GREEN 证据、恢复测试、最终门禁、Review 结论和延期边界。

## 8. 最终门禁

至少执行：

```powershell
node .\.harness\scripts\tests\worktree-worker-runtime.test.mjs
node .\.harness\scripts\tests\worktree-runtime.test.mjs
node .\.harness\scripts\tests\worker-runtime.test.mjs
node .\.harness\scripts\tests\story-runtime.test.mjs
node .\.harness\scripts\tests\state-runtime.test.mjs
node .\.harness\scripts\tests\harness-status.test.mjs
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.harness\scripts\tests\task-dag.test.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.harness\scripts\validate-structure.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.harness\scripts\smoke-harness-flow.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.harness\scripts\select-tests.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.harness\scripts\check-kb-freshness.ps1
git diff --check
```

同时检查：

- `backend/src/**` 和 `frontend/src/**` 没有本 Story 修改，因此不执行无关业务构建。
- M5-B1 state、DAG、manifest 和 receipt Schema/运行时校验一致。
- M5-B1 owned diff 不存在影响稳定性、基本可用性或近期扩展的 `BLOCKER/WARNING`。
- 低概率断电持久化、恶意同进程 Provider、跨平台 Git 输出差异和自动 Worktree 清理只写入报告，不阻塞 M5-B1。

## 9. 交付边界

开发完成后停留在 `git-delivery`，等待用户单独批准。未经批准不执行正式仓库 Worktree 创建、`git add`、`git commit`、`git push`、PR、分支删除、合并、发布或部署。
