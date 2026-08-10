# M5-D-D-001 WaveRetire 生命周期回收技术设计

## 权威设计

完整设计位于：

```text
docs/harness-m5d-wave-retire/DESIGN.md
```

当前确认内容 SHA-256：

```text
sha256:cf317664c40d3070ca4d7c87d05224b5ded3a8984ada94c386d63505ad4a3b74
```

## 实施计划

逐任务实施计划位于：

```text
docs/harness-m5d-wave-retire/PLAN.md
```

当前计划 SHA-256：

```text
sha256:7a45ce70ede8ede08a42041821a1d148913ddfb2d23d3d8d1886d2da6025205e
```

## 核心方案

- 扩展现有 `worktree-runtime.mjs` 和 `run-worktree.ps1`，新增 `WaveRetire/wave-retire`，不创建第二套 Runtime。
- 只接受 `done/completed` Story、`finalized` ledger 和完整 M3 apply/正式产物证据。
- 回收路径、分支、base commit 和任务集合全部从已冻结 Wave 证据派生。
- 首次删除前全局预检全部任务，取得 retirement owner 后重新预检。
- 普通/recovery 双锁绑定预期哈希和 `lockId`，每个 Git/回执/锁释放写点重新验证 owner。
- 按 WavePlan 稳定任务顺序删除 Worktree，每项删除后验证 Git 注册、目录和保留分支事实，再写任务回执。
- partial retirement 只允许精确验证的任务回执前缀进入主树允许集，不放行整个运行目录。
- 最终回执绑定完成态 state、M3 checkpoint、正式产物和全部 Wave/任务回收证据。
- 所有任务分支保留；不执行 branch delete、`prune`、reset、clean、提交、推送、发布或部署。

## 独立评审吸收

- 已增加遗留 retirement lock 的显式 recovery 接管协议。
- 已定义 partial retirement 的稳定回执前缀和精确主树允许集。
- 已补全 Wave/implementation 冲突锁、最终完成态绑定和 Git 删除后验检查。

## 当前门禁

- 本阶段仅完成设计，不实现代码、不创建或删除正式 Worktree。
- 用户审阅本设计前不进入 `task-dag`。
- 用户确认后再使用任务 DAG 规划 Skill 编写逐任务实施计划。
- 未经单独批准，不执行 `git add`、`git commit`、`git push`、PR、发布或部署。
