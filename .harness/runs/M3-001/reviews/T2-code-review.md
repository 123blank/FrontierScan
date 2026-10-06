# T2 代码审核

## 范围

- `.harness/scripts/lib/story-runtime.mjs`
- `.harness/scripts/run-story.ps1`
- `.harness/scripts/tests/story-runtime.test.mjs`
- `.harness/schemas/dispatch-task.schema.json`
- `.harness/schemas/dispatch-result.schema.json`
- `.harness/scripts/lib/state-runtime.mjs` 的工作流只读导出

## 发现

未发现 `BLOCKER` 或 `WARNING`。审核过程中发现的路径归一化缺口已通过 RED/GREEN 修复。

## 审核结论

- `prepare` 只通过 M2 `status` 读取事实状态，不直接修改状态 JSON。
- task 和 checkpoint 会核对 Story、phase、owner、purpose、next、完整输出集合、adapter 集合和 dispatch 身份。
- workflow 输出在归一化后必须仍处于当前 phase 目录，`../` 不能逃逸到其他 run 位置。
- 任务和 checkpoint 只接受普通文件，损坏 JSON 或契约不一致时失败关闭。
- `status` 不创建 `.harness/runs/`，PowerShell 入口保留 Node.js 非零退出码。

## 验证证据

- `node .\.harness\scripts\tests\story-runtime.test.mjs`：通过。
- `node .\.harness\scripts\tests\state-runtime.test.mjs`：通过。
- `run-story.ps1 -Command status -Json`：通过且无写入。
- 真实 `M3-001` 连续两次 `prepare`：第二次复用同一 `dispatchId`。
- 两个 Dispatch Schema 均可由 PowerShell JSON 解析器读取。
- `git diff --check`：无空白错误，仅 Windows 行尾提示。

## 剩余测试边界

没有覆盖多个进程同时首次 `prepare`；M3 当前是单 Story 串行流程，该高压竞争不影响基本主流程。
