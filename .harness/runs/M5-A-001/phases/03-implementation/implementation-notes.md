# M5-A-001 实施说明

## 已完成

- 新增共享 Task DAG 契约，覆盖唯一 wave、依赖顺序、Windows 大小写等价路径冲突、尾部 `/**` 范围和全局变更串行；可选 `ownerAgent` 必须为非空字符串，驱动器相对路径不属于仓库相对路径。
- 新增 Worktree `plan/status/create` Runtime、PowerShell 薄入口和 plan/status Schema。
- `plan` 绑定活动 Story、DAG SHA 和 `dev` commit；`status` 从 Git 事实对账。
- `create` 要求 `ConfirmCreate`，拒绝脏仓库、漂移、占用、第二个 Worktree、junction 和篡改计划。
- 清洁检查只排除已验证的当前 state、绑定 DAG 和当前 run 产物；其他 Harness 或业务修改继续阻塞。
- 临时 Git fixture 覆盖真实创建、重复复用、匹配分支续接、状态写入中断恢复和 Git 失败。

## 边界

未修改 backend/frontend；未在正式仓库创建 Worktree；未实现 Worker 启动、merge/remove、多 Worktree、Fork-Join、推送、发布或部署。
