# T3 代码审核

## 范围

- `.harness/scripts/lib/story-runtime.mjs` 的固定 adapter 与 `apply`
- `.harness/scripts/run-story.ps1` 的 `run-adapter/apply` 参数转发
- `.harness/scripts/tests/story-runtime.test.mjs` 的门禁与恢复用例

## 发现

未发现 `BLOCKER` 或 `WARNING`。

## 审核结论

- adapter ID、可运行 phase、可执行文件、argv 和 cwd 均由代码内固定 registry 决定，调用方不能提交任意 shell 文本。
- 进程使用 `execFile` 和 `shell: false`，registry 不包含 publish、deploy、Git、PR 或 Worktree 操作。
- 成功和失败命令都先写稳定路径证据；unit-test 自动绑定 M2 test record，失败后同 adapter 重跑可按最新同路径证据恢复。
- `apply` 在任何 M2 写入前校验任务身份、结果身份、完整输出集合、普通文件和 phase 路径边界。
- result records 不接受 approval；交付批准仍只能通过 M2 的显式用户批准入口。
- 部分应用重试会按记录字段和当前证据 SHA-256 去重，不会因旧哈希跳过重记。
- completed/failed/blocked 分别由 M2 推进、保留当前 phase 或进入 blocked；M2 测试和审核门禁没有被绕过。

## 验证证据

- `node .\.harness\scripts\tests\story-runtime.test.mjs`：通过。
- `node .\.harness\scripts\tests\state-runtime.test.mjs`：通过。
- `node --check .\.harness\scripts\lib\story-runtime.mjs`：通过。
- 执行面扫描：仅固定 `execFile`，`shell: false`，无外部写操作入口。
- `git diff --check`：无空白错误，仅 Windows 行尾提示。

## 剩余测试边界

adapter 暂不提供通用超时、取消和真实 Agent 权限沙箱；这些属于 M4/M6，不影响当前串行本地命令主流程。
