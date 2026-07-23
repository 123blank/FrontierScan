# Harness M5-B3-A 兼容性验证计划

## 成功标准

- [x] 记录 M3、M5-A、M5-B1、M5-B2、M5-C 的实际单任务契约和冲突点。
- [x] 给出不改变 Runtime 的协议结论、方案比较和推荐演进路径。
- [x] 固定 M5-B3-B 的 task-scoped dispatch、batch-scoped Worktree、状态权边界、失败关闭规则和 TDD 验收。
- [x] 明确在 M5-B3-B 获得单独确认前，不创建 Worktree、不修改 Runtime、不启动 Worker、不执行 Git 写操作。

## 串行任务

### T1：兼容性取证

- 读取当前 M3 dispatch contract、M5-B1 多节点拒绝、M5-B2 单 task receipt 和 M5-C 单 task 生命周期实现。
- 验证知识新鲜度，避免以历史报告替代当前源码。
- 产物：需求拆解和兼容性矩阵。

### T2：协议决策

- 比较 phase 级复用、子 Story 拆分和 task-scoped dispatch v1.1。
- 固定推荐方案：v1.1 task 身份、task 独立产物、batch-scoped Worktree 与独立串行 batch ledger；不扩展 M2 的唯一推进权。
- 产物：`DESIGN.md`。

### T3：实施边界

- 明确 M5-B3-B 的 Schema、Runtime、测试和文档候选范围，但不开始代码实现。
- 固定 RED-GREEN-REFACTOR 顺序、临时 Git fixture 和全量回归门禁。
- 产物：M5-B3-B 验收与延期边界。

### T4：验证与审核

- 校验 M5-B3-A 状态、结构、知识新鲜度和差异格式。
- 对本 Story 文档做只读审核，确认无 Runtime 变更和无越界交付。
- 生成 `REPORT.md` 后停留在 `git-delivery`，等待独立 Git 交付批准。
