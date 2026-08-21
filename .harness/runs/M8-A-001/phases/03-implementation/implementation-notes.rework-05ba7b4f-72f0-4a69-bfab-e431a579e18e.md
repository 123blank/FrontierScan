# M8-A-001 实现返工记录

## 返工原因

交付准备发现 `docs/harness-m8a-review-provider/PLAN.md` 在 Story 初始化前已经是
dirty，但原 implementation result 又将其列为 actual file。State 没有保存初始化时的
文件字节快照，无法安全拆分 Story 前后的同路径修改。

M7-A4 要求 initial dirty 与 actual file 碰撞失败关闭。独立审核确认不应修改该安全协议，
因此使用既有受限 late-stage rework 重新生成 implementation 及后续阶段事实。

## 返工结果

- 保留此前按 TDD 完成的 Provider 配置、契约、上下文、Adapter、Runtime、CLI 和测试实现。
- 纳入 M8-A 报告、目标基线、总体路线、结构清单、交接和知识概览更新。
- 从新 `implementation.actualFiles` 中排除 `PLAN.md`。
- `PLAN.md` 继续作为 baseline initial dirty，由 delivery 保守列入
  `unrelatedDirtyFiles`，不进入 M8-A owned manifest。
- 不修改 baseline，不伪造文件归属，不修改 M7-A4 delivery 协议。

## 开发方法

Provider Runtime 和安全问题均采用 TDD：先增加可复现 RED，再完成最小 GREEN 和范围回归。
本次返工只修正结构化事实和文档收口，没有新增生产代码逻辑。

## 安全边界

- 未执行 Git 暂存、提交或推送。
- 未执行 Worktree、发布、部署或 Docker 操作。
- 未开放开发 Agent、跨供应商 HTTP Adapter、并行或自动 Git。
- 旧 implementation 至 interface-verification 结果作为 superseded 历史保留。
