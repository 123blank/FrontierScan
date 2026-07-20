# M5-A-001 需求拆解

## 目标

在 Task DAG 与未来隔离执行之间增加单 Worktree 的确定性计划、事实状态检查和显式批准创建能力。

## 验收标准

- Task DAG 对 wave 完整性、依赖顺序、路径冲突和全局变更采用失败关闭校验。
- `plan` 将 `dev` 固化为 commit SHA，并生成唯一的任务分支和仓库内 Worktree 路径。
- `status` 以 Git 事实为准识别 absent、created 和 inconsistent，不依赖缓存状态决策。
- `create` 缺少显式确认、存在漂移或占用时不执行 Git 创建。
- 临时 Git 仓库跑通首次创建、重复调用和创建后状态写入中断恢复。
- Runtime 不调用 M2/M3，不修改 Story revision 或 phase。

## 排除范围

不实现多 Worktree、Worker 启动、结果收集、merge/remove、Fork-Join、真实 Agent、推送、发布或部署。

## 待确认事项

无。未返回的选择按已批准计划中的推荐默认值执行。
