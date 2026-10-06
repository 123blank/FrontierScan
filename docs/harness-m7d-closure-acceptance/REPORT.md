# FrontierScan Harness M7-D 双重闭环验收报告

> 完成日期：2026-08-18
>
> Story：`M7-D-001`
>
> 实施基线：`f12d893 feat(harness): implement M7-C knowledge freshness loop`
>
> 最终 State：`.harness/states/e2e-M7-D-001.json`
>
> 最终状态：`done/completed`，revision `19`

## 1. 结论

M7-D 已完成异常 fixture 与真实业务 Story 的双重闭环验收。FrontierScan 当前能够在单仓库、单 Story、当前 Codex 会话串行执行的边界内，从用户业务目标出发完成需求、技术设计、任务 DAG、实现、测试、独立审核、构建、真实 API/UI 验收和交付准备，并在中断后只依赖 State 与磁盘产物恢复。

最终 State 可独立回答需求、决策、知识、DAG、实际修改、测试、审核、构建、验证、验收结论和交付文件归属，不依赖旧聊天记录。`done/completed` 未执行也不代表 Git 提交或推送。

## 2. Fixture 验收

里程碑入口：

```powershell
node .harness/scripts/tests/m7d-closure-acceptance.test.mjs
```

结果：通过，耗时约 245 秒。覆盖：

- block/resume。
- `accepted-with-known-gaps`。
- `accepted-stale`。
- result 漂移与重复 apply。
- 阶段中断恢复。
- 未请求 Git 的合法完成。
- completed State 外的独立 delivery receipt。

最终 State 核验器同时通过路径逃逸、symlink/junction、证据漂移、批准伪造、普通文件类型和构建产物路径边界测试。

## 3. 真实 Story

业务目标：Dashboard 支持按“全部、未读、已读”筛选文章。

最终实现文件共 9 个：

- 后端 Controller、Service、Repository。
- 后端 API 与 Service 测试。
- 前端 API、Dashboard、阅读状态刷新 helper 及其测试。

五项 required acceptance criterion 均为 `verified`。真实环境结果：

```text
all=217
unread=216
read=1
combined=1
invalid readStatus -> HTTP 400
```

Chrome 验收覆盖筛选、分页重置、关键词与标签组合、自动已读、恢复未读及列表往返刷新。最终页面恢复到 `readStatus=all`、空关键词、全部标签、第 1 页。

## 4. Late-Stage Rework

首次 UI 验收发现恢复未读后，文章不会重新进入活动未读列表。原有 State v2 只能在当前阶段继续，无法把验收后缺陷正式回投实现和质量门禁。

用户批准后增加严格受限的 rework：

```text
blocked delivery-preparation
-> implementation
-> unit-test
-> code-review
-> build-publish
-> interface-verification
-> delivery-preparation
```

边界：

- 仅未完成 State v2。
- 只允许从 blocked `delivery-preparation` 回到 `implementation`。
- 历史结果不可改写，当前有效五阶段链通过 supersession 标记。
- 每次 rework 绑定 `reworkId`、触发 revision、原因、actor 和完整阶段链。
- 不支持任意回退、并行、Worktree、Agent Provider 或 Git 自动化。

本次 `reworkId=b1b5b013-0cdb-4aac-82fd-9405209d706a`。返工后的后端 163 个测试、前端 helper 2 个测试、前端构建、独立复审和真实 API/UI 验收均通过。

## 5. 交付准备

`PrepareManifest` 最终在 7.6 秒内完成，推导出 9 个业务 owned 文件。以下 2 个 late-stage rework 新文件被显式列为 `outOfPredictionFiles`：

- `frontend/src/utils/readStatusFilter.ts`
- `frontend/tests/readStatusFilter.test.ts`

Story 前已有 Harness、文档和知识修改保持为 `unrelatedDirtyFiles`，没有被业务 Story 误认领。

交付扫描曾因 208 个 `.harness/runs/M7-D-001/` 未跟踪控制产物进入复制身份折叠而启动大量 Git 子进程。修复后，在没有删除关系时先排除纯控制区新增文件；存在删除关系时仍保留完整折叠，避免漏报跨控制边界重命名。

## 6. 最终核验

通过：

- `verify-story-closure.ps1`，最终 State SHA-256 为 `sha256:18faea3abcb54cd7b399fd863cf61ec8b0bc351652ecd14b9a07352afe4a6852`。
- `m7d-closure-acceptance.test.mjs`。
- `acceptance-gate.test.mjs`。
- `delivery-runtime.test.mjs`。
- `story-closure-verifier.test.mjs`。
- `story-closure-verifier-cli.test.ps1`。
- State、Task DAG、Harness 结构校验。
- `git diff --check`，仅有 LF/CRLF 提示，无空白错误。

closure verifier 将构建产物与证据目录分开校验：正式证据仍受固定目录白名单约束；`backend/target`、`frontend/dist` 等构建产物允许位于仓库业务路径，但必须位于仓库内、避开 `.git`、不经过 reparse point、是普通文件且 SHA-256 匹配。

最终终审还发现 closure verifier 原先只校验 phase-result 文件自身哈希，没有验证 result 内嵌 outputs/records，也没有证明 result payload 与最终 State 投影一致。该问题按 TDD 修复：

- RED 证明修改 `state.design.decisions` 而不修改 technical-design result 时，旧核验器错误通过。
- RED 证明修改 result 已绑定的阶段 output 内容时，旧核验器错误通过。
- GREEN 后核验器严格解析全部 phase-result，校验身份、状态、字节数、SHA-256 和内嵌 outputs/records。
- supersession 后每个阶段必须只存在一个有效 completed result；核验器复用正式 phase projector 重算对应字段并与完成态 State 比较。
- task-dag 只比较不可变规划字段，节点最终状态由 implementation result 单独核对。
- 第二轮复审继续发现白名单内可搬移 result、跨阶段替换 output、跨 attempt 替换 record；新增三条 RED 后，将 result 严格绑定到正式 attempt 路径，加载对应 task 并核对 active workflow、required output set 和 attempt evidence 边界。
- 最终复审发现 attempt evidence 前缀检查早于路径规范化；新增含 `..` 的同 phase 跨 attempt RED，并改为先使用目录边界解析器解析路径，再校验普通文件、字节数和 SHA-256。
- 真实 `M7-D-001` 在增强后的核验器下继续通过。

## 7. 审核

业务返工最终独立只读审核无未解决 BLOCKER/WARNING。M7-D 全量终审及后续复审先后发现 closure verifier 的投影/内嵌内容绑定、正式路径身份和规范化 attempt evidence 边界问题，均已按上述 TDD 方案修复。最终独立只读复审结论为无 BLOCKER、无 WARNING、无新增 NOTE；审核事实不回写 completed State。

## 8. 安全与剩余边界

- 未执行 `git add`、`git commit`、`git push`、PR、发布或部署。
- 未创建或回收正式 Worktree。
- 未接入真实 Agent Provider。
- M7 的单 Story 串行闭环目标已完成；M8-A 仍需先设计、审核并获得用户批准。
- 当前工作区同时包含业务 Story、M7-D Harness 能力、文档和知识刷新修改，提交前必须重新按实际提交目标审核文件范围。
