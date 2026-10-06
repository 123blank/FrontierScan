# M5-D-B-001 实施说明

## 实施范围

- 在现有 `.harness/scripts/lib/worktree-runtime.mjs` 中增加 `wave-create`，不创建第二套 Runtime。
- 在 `.harness/scripts/run-worktree.ps1` 中增加 `WaveCreate` 及审批、计划哈希和锁恢复参数。
- 新增波次锁与完成回执 Schema，并登记到 Harness 结构契约。
- 扩展临时 Git fixture，覆盖普通创建、遗留锁恢复、部分失败和完成回执。
- 更新 Harness、架构、交接和结构化知识文档。

未修改 `backend/src/**`、`frontend/src/**`、数据库、产品接口或界面。

## 已实现行为

- 每次 `WaveCreate` 只处理一个明确 wave，强制要求 `ConfirmWaveCreate` 与当前 `plan.json` 的 `ExpectedPlanSha256`。
- 计划在取锁前后、每次 Git 写入前、状态写入前和回执写入前重新读取并核对哈希。
- 普通创建使用带随机 `lockId` 的 `create.lock`；恢复使用 `create-recovery.lock`，并绑定全部现存锁 SHA-256。
- 同一 run/Story 的所有 wave 共享创建锁和恢复锁，避免不同 wave 在首个 Worktree 出现前同时通过 allowlist。
- 旧创建所有者发现恢复锁后失去 Git、状态、回执和锁释放资格。
- 同一 Story 其他 wave、计划外 Worktree、异地挂载、脏主工作树和身份漂移均失败关闭。
- `created` 项只复核，`branch-only/absent` 项按计划稳定顺序补齐；部分失败不自动回滚。
- 动态锁快照仅返回在 `WaveStatus` 命令结果顶层 `locks`，不写入稳定 `status.json`。
- 只有当前 Git 事实完整为 `ready` 时才写 `creation-receipt.json`，并绑定计划、DAG、稳定状态和任务 HEAD。

## TDD 记录

实施按以下顺序观察 RED 后转为 GREEN：

1. Runtime 不识别 `wave-create`，审批和计划哈希缺失时无法在 Git 写入前失败。
2. `WaveStatus` 不返回结构化锁事实，且没有严格锁 Schema。
3. 普通创建缺少 wave 专用 allowlist、稳定创建顺序和计划 TOCTOU 复核。
4. 旧创建所有者没有 `lockId` fencing，恢复锁不能可靠接管并再次恢复。
5. 部分创建、Git 成功但状态未写、ready 但回执未写的中断窗口不能受控恢复。
6. PowerShell 和 Node CLI 不识别 `WaveCreate` 审批与锁恢复参数，也未拒绝 `TaskId/BaseRef` 身份注入。

每项行为先通过针对性失败用例固定预期，再以最小修改转为通过；随后运行完整 wave 专项和既有 Worktree/Harness 回归。

## 受控中断点

- 取得普通创建锁后计划发生变化。
- 普通创建所有者准备执行下一次 Git 写入前出现恢复锁。
- 取得恢复锁后中断，并通过新批准和当前全部锁哈希再次恢复。
- `git worktree add` 成功后、`status.json` 写入前中断。
- Git 事实已为 `ready`、`creation-receipt.json` 写入前中断。

上述场景均只在测试临时 Git 仓库执行。

## 独立 Review 修订

首次独立只读 Review 给出 `reject`，确认四个阻塞问题：

1. 恢复异常会进入无条件清理路径。
2. 恢复锁替换后没有确认 owner 属于本次生成的 `lockId`。
3. 每-wave 独立锁不能阻止不同 wave 同时起步。
4. Git 分支探测后和状态实际写入点缺少最后计划/owner guard。

修订均先新增可复现 RED，再转为 GREEN：

- 恢复异常保留旧创建证据和当前恢复锁，只有 `ready` 回执成功后清理。
- 恢复替换后强制匹配本次 `lockId`，双恢复并发只有一个 owner 可继续。
- 锁上移为同一 run/Story 共享，双 wave 并发在任何 Git 写入前失败。
- Git 写入、状态写入和释放测试钩子后立即重新校验批准计划和当前 owner。

第二轮复审继续发现并修复：

- 恢复调用在写前钩子后重新读取完整 create/recovery 锁集合，任何新增、缺失或哈希变化都在覆盖前失败。
- 复用 WavePlan 与普通 WaveStatus 改为动态只读，不再持久化观察结果；稳定状态只由初次规划和持锁 WaveCreate 写入，避免陈旧查询破坏回执哈希。

## 安全边界

- 正式 `D:\ProjectStudy\FrontierScan` 仓库未执行 `WaveCreate`、`Create`、`BatchCreate`、Retire 或 Worktree 清理。
- 未启动 Worker，未执行 merge/remove、分支删除、`git worktree prune` 或 M2/M3 状态修改。
- 未执行 `git add`、`git commit`、`git push`、PR、发布或部署。
- 原有未跟踪文件 `CODEX-CROSS-SESSION-HANDOFF.md` 未修改。
