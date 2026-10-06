# M7-C 知识新鲜度闭环实施报告

## 1. 结论

M7-C 已完成 fixture 实施、确定性回归和独立只读审核，可以进入 M7-D 双重闭环验收。

本里程碑没有新增工作流阶段。知识检查、刷新、重查和逐区域 `accepted-stale` 继续嵌入 `technical-design` attempt；Runtime 不自动选择刷新或接受 stale，不执行 Git、Worktree、Docker、发布、部署或真实 Agent 调度。

## 2. 已实现能力

- State v2 的 relevant knowledge area 保存检查事实、Story 决策、source fingerprint、证据、刷新任务、刷新回执和 approval 引用。
- `check-knowledge` 生成 content-addressed freshness evidence 和必要的最小 refresh task。
- 已有 completed `technical-design` result 时，`check-knowledge` 可以在 Story 写锁内原子替换指定 area，用于 source fingerprint 漂移后的正式恢复。
- `refresh-knowledge` 根据白名单 `area/module/mode` 构造固定生成器参数，不执行 result 中的命令字符串。
- backend 和 frontend 刷新只保护自身；common 因实际使用 `Area all`，显式保护 backend、frontend、common 三域。
- refresh receipt 将生成文件、index manifest 和 log 复制为 attempt 内不可变 content-addressed evidence，允许多个 relevant area 依次刷新而不使历史回执失效。
- `custom/` 在刷新前后及后续审计时持续核对，不允许被自动生成覆盖。
- `approve-stale` 生成 `knowledge-stale` approval receipt；`verification-gap` 与 `knowledge-stale` 使用互斥判别契约。
- `knowledge-refresh-required` 已进入最小确定性串行驱动动作。
- completion 复核历史 evidence、task、receipt 和 approval 身份，但不因 implementation 阶段产生的后续源码变化重算设计时 freshness。

## 3. 安全与一致性

- 所有知识产物使用严格字段集合、canonical content ID、文件名和磁盘字节身份校验。
- evidence、task、receipt 和 artifact evidence 必须位于规范化后的当前 attempt 分类目录，`..` 前缀不能绕过目录隔离。
- 知识读写逐级拒绝 symlink、junction、reparse point 和仓库外 realpath。
- 生成器执行前验证 `llm-knowledge`、`index` 和全部 protected area；发现异常时生成器保持零调用。
- common 刷新覆盖全部实际写入区域的 custom snapshot、generated files 和 log 证据。
- 重复 apply、重复 approval 和 receipt 中断恢复保持幂等；State 只由正式 result apply 投影。

## 4. TDD 与审核

实施按 RED-GREEN 推进，覆盖：

- stale/fresh/missing 归一化和最小 refresh task。
- 当前 source fingerprint 漂移。
- content ID、文件名、字段、参数和不可变字节伪造。
- common 跨区域 custom 保护。
- backend、frontend、common 连续刷新后的可组合 receipt。
- result 已存在时的 area recheck 与 apply 恢复。
- junction 仓库外写入和 `..` 目录前缀绕过。
- `knowledge-stale` approval 与 verification case ID 碰撞。
- refresh receipt 写入后中断与幂等恢复。

独立只读审核共进行了三轮修复复审，最终结论为无剩余 BLOCKER/WARNING。审核关闭的问题包括路径逃逸、当前 fingerprint 未重算、产物身份可伪造、common 副作用覆盖不足、approval 类型污染、多区域 receipt 不可组合、源码漂移无正式恢复入口、生成器写入根目录未预检和路径前缀绕过。

## 5. 验证结果

以下检查通过：

```powershell
node .\.harness\scripts\tests\knowledge-runtime.test.mjs
node .\.harness\scripts\tests\approval-contract.test.mjs
node .\.harness\scripts\tests\acceptance-gate.test.mjs
node .\.harness\scripts\tests\state-runtime.test.mjs
node .\.harness\scripts\tests\story-runtime.test.mjs
node .\.harness\scripts\tests\e2e-runtime.test.mjs
node .\.harness\scripts\tests\phase-result-projector.test.mjs
node .\.harness\scripts\tests\generate-kb.test.mjs
node .\.harness\scripts\tests\harness-status.test.mjs

powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.harness\scripts\tests\kb-freshness.test.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.harness\scripts\tests\e2e-cli.test.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.harness\scripts\validate-structure.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.harness\scripts\smoke-harness-flow.ps1

git diff --check
```

最终结构校验基线为 38 个目录、272 个必需文件和 13 个 Skill 文件。

## 6. 剩余风险与下一步

当前验证以 fixture 和受控生成器为主，尚未证明真实业务 Story 中的知识刷新耗时、生成内容质量和交互体验。该风险属于 M7-D：

1. 使用异常 fixture 验收 block/resume、accepted gap/stale、漂移、重复 apply 和中断恢复。
2. 选择一个范围较小的真实业务 Story，完整执行 State v2 串行闭环。
3. 真实 Story 通过后刷新相关知识和目标基线，再决定是否启动 M8。

M7-C 完成不表示已经执行 Git 提交或推送。
