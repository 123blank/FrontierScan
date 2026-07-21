# M5-B1-001 技术设计

## 设计结论

- 新增独立内部模块 `worktree-worker-runtime.mjs`，组合 M5-A `runWorktreeCommand(status)` 与 M4-B `runWorkerTask`，不扩展现有 CLI。
- 输入采用混合快照：当前 run 的 Harness 文件原子复制到 Worktree；已提交源码和文档直接读取固定 base Worktree。
- M5-B1 只接受当前 DAG 唯一 pending task，DAG owner 必须与 M3 task owner 一致。
- Worker 完成后比较 Worktree Git 事实并记录文件哈希；未知写入、删除、输入篡改和身份漂移均失败关闭。
- 仅 phase output 时写入主工作树产物，并最后写 M3 正式 `result.json`，返回 `ready-for-apply`。
- 存在 backend/frontend 写入时不复制业务代码、不写正式 result，只写独立 Worker result 和 execution receipt，返回 `ready-for-integration`。
- 编排器不调用 M2/M3 状态命令；调用方显式执行 M3 `apply`。

## 证据结构

```text
.harness/runs/<runId>/worktrees/<taskId>/
  plan.json
  status.json
  input-manifest.json
  worker-result.json
  execution-receipt.json
  execute.lock
```

input manifest 记录每项输入的来源、源/目标相对路径、SHA-256 和字节数。receipt 记录 Story、run、task、dispatch、phase、owner、plan/status/input 哈希、base/head commit、结果级别、变更文件清单与 Worker result 证据。

## 稳定性与恢复

- 执行前重新从 Git 核验 Worktree branch、HEAD 和 base commit。
- 路径保持仓库相对且不得穿越符号链接；沿用 M4-B 单文件 2 MiB、总上下文 8 MiB 限制。
- 使用 task 级独占锁；遗留锁只报告，不自动删除。
- 主工作树文件使用临时文件加 rename，正式 `result.json` 最后写入。
- 已存在匹配 receipt 时幂等复用；Worker 已完成但 receipt 未写入时从 manifest、result 和 Git 事实恢复，不重复调用 Provider。

## 详细方案

开发和审核以 `docs/harness-m5b-worktree-worker/DESIGN.md` 为权威设计说明，以同目录 `PLAN.md` 为串行 TDD 执行顺序。

## 延期边界

M5-B2 再处理 task-level dispatch、多任务聚合、业务代码集成、Worktree 合并/清理和并行波次。断电级 fsync、恶意同进程 Provider 的操作系统隔离和跨平台 Git 差异只记录到最终报告。
