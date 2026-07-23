# M5-C-001 技术设计

权威设计位于 `docs/harness-m5c-worktree-lifecycle/DESIGN.md`，本阶段固定采用以下实现：

- 在既有 `worktree-runtime.mjs` 扩展 `retire`，复用 M5-A 的派生路径、Git argv、计划绑定和锁模式。
- 目标 state 必须为完成的 M5-B2 Story；Retire 通过 M5-B1 execution receipt、input manifest、M5-B2 integration receipt 和根目录文件哈希建立可删除性证明。
- 仅当 Worktree 变更集合完全等于已声明输入、候选和 `result.json` 时，才执行 `git worktree remove --force`；保留分支。
- retirement receipt 使用原子写入；Git 成功但 receipt 未写入时仅在历史 status 和全部证据仍匹配时恢复。
- Runtime 不调用 M2/M3 状态命令，不创建、合并或删除分支，不执行正式仓库回收测试。
