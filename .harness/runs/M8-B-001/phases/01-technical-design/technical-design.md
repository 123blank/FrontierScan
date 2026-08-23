# M8-B-001 技术设计投影

## 设计来源

正式设计以 `docs/harness-m8b-development-provider/DESIGN.md` 为准。该设计采用方案 B，并已通过三轮独立只读审核，最终为 `0 BLOCKER / 0 WARNING`。

当前 Story 只投影已经批准的实现边界，不重新设计 M8-B，也不扩大到并行、Fork-Join、自动 Git 或外部 Provider。

## 核心链路

```text
State v2 implementation task
-> 冻结 DAG node、predictedFiles、知识、角色、模型与 Worktree
-> 用户批准并创建单任务 Worktree
-> codex exec --sandbox workspace-write --cd <worktree>
-> Agent 直接修改 Worktree
-> Runtime 对账 Git、文件系统与声明
-> Materialize candidate manifest
-> Runtime 固定 Test
-> Finalize notes/result/evidence/development receipt
-> M5-B2 内容寻址集成
-> Story Runtime Apply
```

## 已批准决策

1. 只开放 `backend-developer` 和 `frontend-developer`，首版单任务、单 Worktree、串行执行。
2. Agent 直接写任务 Worktree，不直接写主工作树、State、正式 result 或 Git 历史。
3. 模型路由复用 M8-A 的 `role -> profile -> adapter/model`，模型配置不能改变权限。
4. `workspace-write` 是工作区级边界；`predictedFiles`、角色策略与 Runtime 对账是集成前准入门禁。
5. Run 和 Materialize 禁止 ignored 路径变化；正式测试使用 Runtime 固定且未被 Agent 污染的工具链。
6. implementation payload 保持现有五字段契约；Provider、Worktree、candidate 和 test 事实通过标准 attempt evidence 投影记录。
7. M5-B2 以固定路径区分 legacy Worker 与 Development Provider，双来源同时存在时失败关闭。
8. legacy integration plan v1.0 保持兼容；development source 使用 v1.1 并在重放时深检原始证据。
9. Finalize 生成 notes、result 候选、正式 evidence 投影和 Development Provider receipt；M5-B2 保持 result-last。
10. 不自动创建、清理或回收 Worktree，不自动执行 Git、发布、部署或任意模型生成命令。

## 知识状态

当前任务只涉及 Harness common 区域。2026-08-22 的正式 Story Runtime 检查结果为：

```text
area=common
status=fresh
semantic=pending
index=fresh
source fingerprint unchanged
```

`semantic=pending` 是当前知识系统的已知能力状态，不表示 common 基线过期；本设计同时以现有 Runtime、Schema 和测试源码完成了契约核验。

## 主要风险与控制

### Worktree 越权写入

Agent 可能修改 `predictedFiles` 外文件或不支持的文件类型。Runtime 必须将执行前后普通文件、ignored 路径和 Git 事实全部对账，任一越权变化使整个 attempt 失败。

### 测试工具链污染

Agent 可能生成或修改 `target/`、`dist/` 或 `node_modules`。Run/Materialize 禁止 ignored 变化；backend 测试绑定 Worktree 外 Maven/JDK 身份，frontend 缺少可信完整依赖快照时返回 `adapter-selection-required`。

### 共享 Git 元数据漂移

linked Worktree 的 refs、config 和 index 位于共享 Git 目录。Runtime 记录并重验 `git-dir`、`git-common-dir`、完整 refs、`packed-refs`、config、index、HEAD 和 branch，只声明未观察到受检查事实漂移。

### 中断和重复执行

Provider 使用 claim-first、随机 owner lock、原子写入、唯一成功 execution 和内容哈希。claim-only 不自动重跑；污染 Worktree 不自动 reset、clean 或删除。

### State 与集成协议漂移

M8-B 不升级 State v2 或 implementation payload。正式 records 只引用 `<attemptRoot>/evidence/`；M5-B2 development plan v1.1 绑定原始 request、candidate、test、result 和 source receipt。

## 验收策略

先完成契约与 Runtime fixture，再运行完整回归和独立只读审核。真实 Codex CLI fixture 通过后，选择一个有现有测试、无迁移和共享配置变化的 backend 单任务 Story 完成九阶段闭环。frontend 先通过可信依赖快照 fixture，不作为首个真实业务验收任务。
