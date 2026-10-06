# FrontierScan Harness M5-A 实施报告

> Story：`M5-A-001`
> 日期：2026-07-20
> 状态：实现、完整测试、最终只读审核和本地 Git 提交完成

Harness 工作流在 revision 12 进入 `git-delivery`，随后追加测试和审核证据；用户批准本地 `git add/commit` 后，M5-A 业务修改提交为 `28e009c66a3d801208ad931037d659067e0e10ce`。状态运行时已在 revision 19 进入 `done/completed`。本次收尾已获得执行 `git push origin dev` 的明确批准，远程同步结果以 Git 引用核验为准；PR、合并、分支删除和 Worktree 清理仍未获批准或执行。

## 1. 实现结论

M5-A 已增加单 Worktree 的 `plan/status/create` 受控边界。Task DAG 在进入计划前校验 wave 完整性、依赖顺序、路径冲突和全局变更串行；计划固定 `dev` commit SHA 并绑定 DAG SHA；状态与创建以 Git 事实为准，不调用 M2/M3。

正式创建需要用户逐次批准和 `ConfirmCreate`。Runtime 不接受任意目标路径或分支，不使用 shell，不执行 merge/remove、reset、clean、提交、推送、发布或部署。

## 2. TDD 与恢复证据

- RED 证明旧 DAG 校验遗漏任务唯一 wave、逆序依赖、同波次冲突和 globalChanges 并行。
- 审核 RED 进一步证明旧契约会接受非字符串 `ownerAgent` 和 `C:outside.md` 驱动器相对路径；修复后两者均在 DAG 入口失败关闭。
- RED 证明 Worktree Runtime、批准创建、幂等和恢复能力在实现前不存在。
- 临时 Git 仓库覆盖 absent、created、inconsistent、无批准、脏仓库、base 漂移、路径/分支冲突、遗留锁、第二个 Worktree、junction、Git 失败和创建后状态写入中断。
- 属性重排、计划篡改、DAG 漂移和 Runtime 输出目录 junction 的审查回归已加入测试。
- Worktree 忽略规则回归先稳定复现主仓库出现 `?? .harness/worktrees/...`，再通过单条 `.gitignore` 规则完成 GREEN；测试正向断言 plan/status 运行证据可见，并反向断言 Worktree 目录不可见。
- PowerShell 纵向 fixture 完成 `DAG validate -> Plan -> Status -> Create -> Status`，状态文件前后完全一致。

## 3. 稳定性边界

- Git 使用固定 argv、无 shell、30 秒超时和 4 MiB 输出缓冲。
- plan/status 使用同目录临时文件加 rename；create 使用任务级独占锁。
- 完全匹配的既有 Worktree 返回 `reused`；匹配分支未挂载时继续挂载；任何身份、SHA、路径、分支或 HEAD 漂移均失败关闭。
- 主仓库清洁校验只排除已验证的当前 state、绑定 DAG 和当前 run 目录，不忽略其他 Harness 或业务修改。
- `.harness/worktrees/` 作为本地嵌套 Git 工作区从主仓库状态排除，避免创建后污染后续清洁检查；`.harness/runs/` 继续纳入交付。

## 4. 延期边界

M5-B 或以后再处理多 Worktree 波次、Worker 启动、结果收集、merge/remove、Fork-Join、并发 Agent 和自动清理。断电级 fsync、崩溃遗留锁自动回收、手工迁移 Worktree、非 Windows 差异和 Git 版本行为变化属于低概率边界，本 Story 不加固。

## 5. 最终门禁

- M5-A Worktree Runtime 11/11、Task DAG、M4-B Worker、M3 Story、M2 State 和 Harness status 测试通过。
- Harness Smoke 通过；结构为 22 个目录、138 个必需文件、13 个 Skill。
- 7 个状态文件、4 个现有 Task DAG 全部通过校验。
- backend、frontend、common 知识均为 `fresh`；backend/frontend 无差异，构建计划为 `no-build-required`。
- `git diff --check` 无空白错误，仅报告 Windows LF/CRLF 转换提示。
- 五轮审核已修复 Git 选项边界、DAG Schema/运行时漂移、当前 Story 未提交 Harness 产物阻塞创建、嵌套 Worktree 污染、非法角色/路径输入、测试断言和报告状态漂移问题。
- 最终只读审核无影响稳定性、基本可用性或近期扩展的未解决 `BLOCKER/WARNING`。
