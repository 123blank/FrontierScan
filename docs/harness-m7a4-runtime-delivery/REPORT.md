# FrontierScan Harness M7-A4 实施报告

## 1. 结论

M7-A4 已完成代码实施、专项 fixture、兼容回归和独立只读审核。

本阶段建立了以下闭环：

- State v2 evidence 使用共享语义身份，相同事实重放不增加 revision、events 或 records。
- delivery owned 只来源于 `implementation.actualFiles`，DAG prediction 只用于预测外风险分类。
- baseline 到当前工作树的 Git 净变化覆盖 committed、staged、unstaged、untracked、delete/recreate、rename 和 copy。
- owned manifest 冻结内容 SHA-256、Git blob OID 和普通文件 mode。
- `delivery-preparation apply` 在 State 写锁内重算 facts，并核对 payload、报告和 manifest。
- completed State 外可追加 delivery receipt，记录 not-requested、commit 和 push 事实，不修改完成 State。
- `run-delivery.ps1` 不提供 Git 写操作。

## 2. TDD 记录

主要 RED：

- 缺少 `record-contract.mjs`。
- v2 重复 record 仍写入 State。
- 手工 output 与自动 output 重复。
- 缺少 delivery Runtime、manifest 和 receipt。
- ready delivery 未强制 summary/manifest。
- rename manifest 被错误拆成 deleted + renamed。
- delete/recreate 产生同路径 deleted + added。
- Story apply 期间 State lock 被误报为 unrelated。
- receipt Runtime 尚不存在。

主要 GREEN：

- `record-contract.test.mjs`、`state-runtime.test.mjs` 和 `story-runtime.test.mjs` 验证共享语义幂等。
- `delivery-runtime.test.mjs` 覆盖归属、prediction、initial dirty、控制资产、rename/copy、manifest、commit 和 push。
- `delivery-cli.test.ps1` 验证入口参数及无 Git 写命令。

## 3. 独立审核

中途审核发现：

1. 删除后同路径重建未折叠。
2. rename 只检查 target 控制资产。
3. manifest 正式入口缺 Story 锁和阶段限制。
4. POSIX mode 读取 index 而非当前工作树。

处理结果：

- 使用 baseline tree blob/mode 与当前文件身份进行确定性归并。
- rename/copy 同时检查 source 和 target；跨控制资产关系失败关闭。
- `PrepareManifest` 在 Story 写锁内重读 active delivery State，并在写前二次对账。
- 非 Windows 平台从当前文件 executable bit 推导目标 mode。

第二轮审核发现：

1. copy source 未参与控制资产和 initial-dirty 检查。
2. receipt 内部 `receiptId/recordedAt` 漂移未失败关闭。
3. receipt 遗留锁缺少崩溃恢复。
4. CLI 未拒绝无关参数组合。

处理结果：

- 分离交付数组展开路径与安全端点，copy source 参与控制资产和污染检查。
- receipt ID 由冻结事实确定，`recordedAt` 绑定 completed State 的 `runtime.updatedAt`，重试可重建并核对全字段。
- receipt 锁增加 `lockId/pid/hostname/createdAt`、死进程陈旧锁恢复和 owner 精确释放。
- PowerShell 在启动 Node 前严格校验命令参数组合。

第三轮收敛复审结论：无 BLOCKER/WARNING，批准 M7-A4。

## 4. 验证结果

- record、delivery Runtime、delivery CLI、State Runtime、Story Runtime、阶段投影、验收门禁和批准契约通过。
- `validate-structure.ps1` 通过：35 个目录、254 个必需文件、13 个 Skill。
- `smoke-harness-flow.ps1` 通过。
- State v2 模板与 Task DAG 示例校验通过。
- Batch 32/32、串行批次 1/1、Worktree 28/28、生命周期 39/39、集成 44/44、Wave 35/35、execution ledger 9/9 通过。
- 大型 Worker/Wave 综合套件运行到 72 条均通过后触发 10 分钟命令超时，未产生失败证据。
- `git diff --check` 无空白错误，仅有 Windows 行尾转换提示。
- 知识新鲜度仍为 `stale-or-incomplete`，属于 M7-C 范围。

## 5. 安全边界

- 未执行 `git add`、`git commit`、`git push`。
- 未创建或回收正式 Worktree。
- 未执行 Docker、发布或部署。
- receipt 只记录经 Git 只读命令验证的事实，不执行外部状态变更。
