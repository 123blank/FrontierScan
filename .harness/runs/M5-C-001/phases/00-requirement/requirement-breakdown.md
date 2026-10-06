# M5-C-001 需求拆解

## 目标

为已完成 M5-B2 集成的单 Worktree 建立审批门控、凭据绑定、可恢复的安全回收能力，避免遗留 Worktree 和未知未提交内容长期占用本地仓库。

## 范围

- 新增 M5-A `Retire` 命令和对应 retirement receipt。
- 仅处理 M5-B1 `ready-for-integration` 且 M5-B2 已集成、目标 Story 已 `done/completed` 的单任务 Worktree。
- 保留分支；不处理多任务、多 Worktree、phase-only Worktree、分支删除、自动 prune、发布和部署。

## 验收标准

- [ ] 无用户确认或无 `ConfirmRetire` 时不执行 Git 移除。
- [ ] 缺少、篡改或身份不匹配的 M5-A/M5-B1/M5-B2 凭据、未知 Worktree 改动、锁或漂移均失败关闭。
- [ ] 已验证的临时 fixture 能移除 Worktree、保留分支和主树集成结果，并写入 retirement receipt。
- [ ] Git 移除后 receipt 写入中断可在相同证据下恢复；重复 Retire 不再次执行 Git 移除。
- [ ] M2/M3 target state 的 phase 和 revision 不因 Retire 改变。

## 知识与风险

知识新鲜度：backend、frontend、common 均为 fresh；实现依据以 M5-A/B1/B2 Runtime 和临时 Git fixture 为准。主要风险是 `--force` 可能丢弃未知改动，因此只允许可由 manifest、receipt 和 result 完整解释的路径集合。
