# M4-B 受约束 Mock Worker 技术设计

## 1. 架构

新增独立 `worker-runtime.mjs`，仅通过模块 API 使用。它读取现有 M3 task 和角色策略、加载显式 context、调用 mock provider、校验候选并执行 result-last 文件写入。它不调用 `runStateCommand` 或 `runStoryCommand`。

共享 `dispatch-contract.mjs` 提供 task/result 的纯结构校验，M3 和 Worker 共同调用，避免 Schema `1.0` 契约漂移。M3 原有 workflow、当前状态、普通文件、证据和 phase 门禁继续保留。

## 2. 权限模型

策略文件为每个 Agent 角色声明 category、readPathPrefixes、writePathPrefixes 和 capabilities。运行时严格提取 `agents.yaml` 的 name/category 并比较集合。固定能力映射为：当前 phase 必需产物、backend 源码、frontend 源码和 backend 测试源码；没有 shell、网络、Git、发布或状态能力。

context 只接受调用方给出的仓库相对普通文件。候选文件路径先完成词法边界、现有路径逐级 symlink、策略前缀和 capability 检查，再允许创建临时文件。

## 3. 数据和限额

- task、当前角色策略和 context 总量：8 MiB。
- 单个 context 或候选文件：2 MiB。
- 候选文件与序列化 result 总量：8 MiB。
- timeout 默认且最大为 30 秒；AbortSignal 提供协作取消。
- completed result 输出集合必须与 task expectedOutputs 完全相同。
- result record 的路径必须指向本次候选文件；approval 不属于公开枚举。

## 4. 写入和恢复

全量校验完成后，所有候选内容先写目标同目录的 dispatch 专属临时文件；全部临时文件成功后按规范化路径排序 rename。`result.json` 使用独立临时文件并在最后 rename。中断导致的部分产物不会伴随新 result，同一 task/dispatch 可显式重试覆盖。

## 5. TDD 和集成

按策略、context/provider、候选校验、原子恢复、纵向闭环五组行为串行 RED/GREEN。最终运行 Worker、M3、M2、Harness 状态、结构、Smoke、知识新鲜度和 diff 检查；只审核 M4-B owned diff。
