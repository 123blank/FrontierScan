# FrontierScan Harness M7-D 双重闭环验收设计

> 日期：2026-08-14
>
> 状态：已实施并通过异常 fixture、真实 Story、最终 State 核验和独立业务复审
>
> 所属路线：`M7-D`
>
> 前置里程碑：M7-A1、M7-A2、M7-A3、M7-A4、M7-B、M7-C 已实施并通过专项 fixture 与独立只读审核
>
> 实施基线：`f12d893 feat(harness): implement M7-C knowledge freshness loop`

## 1. 目标与防偏移说明

M7-D 对应长期目标中的“单 Story 确定性闭环完成真实业务验收”。本阶段不继续扩展 Runtime，而是证明 M7-A1 至 M7-C 已建立的能力能够同时处理确定性异常和真实业务开发：

```text
异常 fixture
+ 真实业务 Story
+ 最终 State 机器核验
-> M7 单 Story 闭环验收
```

本阶段解决以下剩余差距：

- 异常能力目前分散在多个 Runtime 测试中，缺少 M7 里程碑级机器验收入口。
- State v2 和串行驱动器尚未通过一个新的真实业务 Story。
- 尚未证明仅读取最终 State 即可回答完整闭环事实。
- M7 完成证据尚未统一进入专项报告、目标基线、结构清单、知识和交接文档。

本阶段不实现：

- 新的 State、阶段、result 或 approval 协议。
- 新的 Agent Provider、Agent 自动派发或多 Agent 协商。
- Worktree、并行、Fork-Join 或多 Story 编排。
- Docker Compose 环境闭环、生产发布或外部平台写入。
- 自动执行 `git add`、`git commit`、`git push` 或创建 PR。
- 为通过验收而制造真实业务阻塞、缺口或 stale 接受。

如果验收暴露现有 Runtime 缺陷，只允许修复可复现且阻塞 M7 验收的问题，并为修复增加针对性回归测试；不得借机增加后续里程碑能力。

### 1.1 实施后批准偏差

真实 UI 验收发现列表往返刷新缺陷后，原有工作流无法把 late-stage 问题正式回投 `implementation`。用户明确批准增加严格受限的 `delivery-preparation -> implementation` rework/supersession；该能力只服务未完成 State v2 的验收后返工，不提供任意阶段回退。

交付准备还暴露纯控制区未跟踪文件在归属推导前被执行复制身份折叠的性能问题；该问题按 TDD 在 `delivery-runtime.mjs` 当前职责内修复。最终 State 核验器同时修正了“构建产物必须位于证据目录”的错误边界。完整实际结果见 `REPORT.md`。

## 2. 方案比较

### 2.1 方案 A：薄验收层

新增一个 M7-D 专项 acceptance 测试入口和一个只读最终 State 核验器，复用现有 Runtime、fixture helper 和交付回执协议。

优点：

- 不复制九阶段编排、投影、门禁或恢复逻辑。
- 为 M7 提供独立、稳定、机器可执行的验收入口。
- 能把分散的异常能力映射到明确的里程碑验收项。
- 最终 State 核验器可继续用于后续真实 Story 和 M12 评估。

缺点：

- 需要维护一份里程碑验收场景与现有 Runtime 能力的显式映射。

### 2.2 方案 B：独立场景回放器

新增一个完整的九阶段异常回放 Runtime，在临时仓库中自行编排全部场景。

优点：

- 所有证据集中在单一执行入口。

缺点：

- 重复 Story Runtime 和 E2E Runtime 已有职责。
- 容易形成第二套状态推进与恢复语义。
- M7-D 会从验收阶段扩大为新的 Runtime 开发阶段。

### 2.3 方案 C：只引用现有测试

不增加机器验收资产，只在报告中引用现有测试和真实 Story 结果。

优点：

- 修改最少。

缺点：

- 无法通过一个确定性命令判断 M7-D fixture 是否完整通过。
- 最终 State 完整性仍依赖人工阅读。
- 后续回归难以发现某个异常验收项被删除或失效。

### 2.4 结论

采用方案 A。M7-D 只增加验收层，不增加新的生产编排能力。

## 3. 总体架构

新增两类独立资产：

```text
M7-D acceptance 测试
  -> 在临时 fixture 中调用现有 State/Story/Knowledge/Delivery Runtime
  -> 覆盖规定的异常和交付语义

最终 State 核验器
  -> 只读取 completed State
  -> 校验闭环事实是否完整、可追踪、可判定
  -> 输出稳定 JSON 和退出码
```

真实 Story 继续使用正式入口：

```text
run-state init
-> run-e2e Status/Step/Apply
-> 当前 Codex 会话完成认知任务
-> 固定 Adapter 和真实测试提供确定性证据
-> delivery-preparation
-> done
-> final-State verifier
```

验收层不得直接修改 State，不得绕过 `run-story`、`run-e2e` 或现有交付 Runtime。

## 4. M7-D Acceptance 测试

### 4.1 测试入口

新增：

```text
.harness/scripts/tests/m7d-closure-acceptance.test.mjs
```

该文件是里程碑级纵向验收，不复制 Runtime 实现。它可以复用或提取现有测试 helper，但必须通过公开 Runtime 接口执行场景。

每个场景使用独立临时目录或临时 Git 仓库，场景之间不得共享 State、活动指针、Git HEAD 或 receipt。

### 4.2 必需场景

#### block/resume

- 对当前 attempt 应用合法 blocked result。
- State 进入 `blocked`，`activeBlock` 保存当前阻塞。
- resume 后回到原阶段，`activeBlock=null`。
- 历史 blocked/resumed 事件仍可审计。
- 恢复后生成新的 attempt，不复用被阻塞 result。

#### accepted-with-known-gaps

- required verification case 为 blocked 或存在明确缺口时不能直接推进。
- 用户批准必须绑定 case、当前 result、evidence、理由和 SHA-256。
- 合法批准后状态进入 `accepted-with-known-gaps` 并可完成。
- result 或 evidence 漂移后旧批准失效。

#### accepted-stale

- relevant stale knowledge 在未刷新或未批准时阻止 technical-design apply。
- 批准按 area 独立生成，不能用一次批准覆盖多个 area。
- State 保留 observed stale 事实，不得把 accepted-stale 描述为 fresh。
- freshness evidence 或 refresh task 漂移后旧批准失效。

#### result 漂移和重复 apply

- result 在 apply 前身份、revision、output 或哈希漂移时 State 零写入。
- 已成功 apply 的同一 result 再次提交返回幂等结果。
- 重复 apply 不重复增加 records、logs 或阶段投影。
- 正式 result 在 apply 后被修改时必须失败关闭。

#### 阶段中断恢复

- 覆盖 State 推进前中断和 State 推进后回执未完成两类窗口。
- 重试只能完成缺失的提交步骤，不重复投影或越过阶段。
- 新会话只依赖磁盘 State、attempt、checkpoint 和正式 result 即可恢复。

#### 无 Git 完成

- `delivery-preparation` 通过后，`delivery.gitStatus=not-requested` 的 Story 可以进入 `done/completed`。
- completion gate 不要求 Git approval、commit 或 push。
- completed State 保持不可变。

#### 完成后交付回执

- 在独立临时 Git fixture 中创建真实 commit，并使用现有 delivery Runtime 记录 receipt。
- receipt 必须绑定 completed State、owned files 和真实 Git commit。
- 不存在的 commit、错误 parent、缺失 owned file 或 remote/ref 不匹配必须失败。
- 记录 receipt 不得修改 completed State。

该场景只验证交付协议，不授权对 FrontierScan 当前仓库执行 Git 写操作。

### 4.3 验收结果

测试入口成功时输出固定摘要：

```text
M7-D closure acceptance fixtures passed
```

任一场景失败时返回非零退出码。测试不得通过捕获并忽略异常的方式伪造成功。

## 5. 最终 State 核验器

### 5.1 公共接口

新增：

```text
.harness/scripts/verify-story-closure.ps1
.harness/scripts/lib/story-closure-verifier.mjs
```

PowerShell：

```powershell
.\.harness\scripts\verify-story-closure.ps1 `
  -StateFile .harness/states/e2e-<storyId>.json `
  -Json
```

Node：

```js
verifyStoryClosure({
  root,
  stateFile,
});
```

核验器只读，不更新 State、活动指针、事件、attempt、报告或知识。

### 5.2 输入边界

核验器只允许读取：

- 指定 State v2 文件。
- State 正式引用并绑定 SHA-256 的必要证据。
- 版本化 workflow 和 Schema。

路径安全要求：

- `stateFile` 必须是仓库 `.harness/states/` 下的普通文件。
- State 引用的 output、evidence、approval、DAG 和其他正式产物必须使用仓库相对路径。
- 所有路径先规范化，再验证目标仍位于对应允许目录内；拒绝绝对路径、空路径、`..` 逃逸和仓库外 realpath。
- 从仓库根目录到目标文件逐级拒绝 symlink、junction 和其他 reparse point，目标必须是普通文件。
- workflow 和 Schema 根据已验证的 `schemaVersion` 与 workflow 版本映射到 Runtime 固定的版本化路径，不接受 State 提供任意 workflow 或 Schema 文件。
- 路径、文件类型或目录包含关系不满足要求时失败关闭，不读取目标内容。

核验器不得读取：

- 聊天记录。
- Markdown 报告正文来推断核心事实。
- 未被 State 正式引用的 attempt 草稿。
- delivery receipt 来改变 completed State 的结论。

Markdown 可以作为 State 正式 output 被校验存在性和哈希，但不能作为核心事实解析源。

### 5.3 核验内容

核验器必须确认：

1. State 为 Schema v2，且 `phase=done`、`runtime.status=completed`。
2. requirement 存在稳定、唯一的 acceptance criteria。
3. technical design 保存关键决策、影响区域、风险和知识快照。
4. 所有 relevant knowledge area 为 `fresh` 或具有有效逐项 `accepted-stale`。
5. DAG 路径、哈希、节点、依赖、波次和 criterion 引用完整。
6. implementation 节点均具有最终状态、实际文件和开发方法或例外。
7. required unit tests 覆盖对应 criterion，且无未关闭失败。
8. code review 无未解决 BLOCKER/WARNING。
9. build result 真实记录成功、失败或未执行原因。
10. 每个 required criterion 都有最终 interface verification 结论。
11. `accepted-with-known-gaps` 具有当前 subject 的有效逐项批准。
12. acceptance summary 与测试、验证和批准事实一致。
13. delivery preparation 保存 owned files、预测外修改、剩余风险和 `gitStatus`。
14. 核心阶段 output、record、approval 和 evidence 引用的路径与 SHA-256 有效。

核验器输出至少包含：

```text
schemaVersion
storyId
runId
status
stateFile
stateSha256
requirement
decisions
knowledge
dag
implementation
tests
review
build
verification
acceptedGaps
delivery
diagnostics
```

`status` 只允许：

```text
passed
failed
```

成功返回退出码 `0`，结构或语义缺失返回非零退出码。

### 5.4 Git 回执边界

completed State 表示业务开发和交付准备闭环完成，不表示 Git 已执行。核验器要求：

```text
delivery.status = ready
delivery.gitStatus = not-requested | requested
```

核验器原样报告合法的 `gitStatus`。完成后的 commit/push 事实继续由版本化 `delivery-receipt.json` 表达，并由现有 delivery Runtime 独立验证。核验器不得因为没有 receipt 而判定业务闭环失败，也不得把 receipt 内容回写 completed State。

## 6. 真实业务 Story

### 6.1 Story 定义

真实 Story 为：

> 用户可以在 Dashboard 的文章列表中按“全部、未读、已读”筛选文章。

选择原因：

- 复用现有 `Article.readAt`，不新增数据库字段或迁移。
- 不需要 LLM、采集器、Redis、外部网站或生产服务。
- 同时覆盖 backend、frontend 和 common Harness 知识。
- 能运行后端单元测试、API 集成测试、前端类型检查和构建。
- 用户可观察行为明确，验收项容易绑定测试和浏览器证据。
- 范围足够小，不会把 M7-D 变成新的业务大版本。

### 6.2 业务边界

- 只修改 Dashboard 文章列表。
- Favorites 页面不增加阅读状态筛选，也不发送该参数。
- 不扩展共享 `ArticleFilterBar` 的默认事件契约；可以在 Dashboard 增加独立紧凑控件，或通过显式 prop 仅在 Dashboard 启用。
- 后端参数使用受限枚举：

```text
readStatus=all
readStatus=unread
readStatus=read
```

- 未提供参数或提供 `all` 时保持当前查询行为。
- 非法值返回明确的客户端错误，不静默退回 `all`。
- 阅读状态筛选可以与 category、site、keyword、tag 和 date 条件组合。
- 切换筛选后回到第一页，保留现有 page size 和其他筛选条件。
- 本 Story 不增加批量标记、未读计数、Favorites 筛选或筛选持久化。

### 6.3 业务验收标准

使用稳定 criterion ID：

```text
AC-READ-FILTER-1
```

在 Dashboard 选择“未读”时，只显示当前用户 `readAt=null` 的文章。

```text
AC-READ-FILTER-2
```

在 Dashboard 选择“已读”时，只显示当前用户 `readAt!=null` 的文章。

```text
AC-READ-FILTER-3
```

选择“全部”或未提供参数时，保持现有文章列表语义，并能与已有分类、关键词、标签和日期条件组合。

```text
AC-READ-FILTER-4
```

非法阅读状态参数被明确拒绝，且不能访问或泄露其他用户文章。

```text
AC-READ-FILTER-5
```

切换阅读状态筛选后回到第一页，界面显示的选中状态、请求参数和文章结果一致。

### 6.4 测试与验证

后端至少覆盖：

- Service 或 Repository 对 `all/read/unread` 的行为。
- API 参数绑定和非法值。
- 阅读状态与现有筛选条件组合。
- 分页结果。
- 用户数据隔离。

前端至少执行：

```text
npm run build
```

构建只证明 TypeScript 和打包通过，不能代替 UI 验收。interface-verification 必须通过真实浏览器或等价可执行环境验证：

- 三个筛选状态可见且互斥。
- 切换后请求包含正确 `readStatus`。
- 列表结果和状态一致。
- 切换后页码回到第一页。

如果当前运行环境无法启动真实后端或浏览器验证，必须记录 `blocked`。只有用户针对具体 case、理由和证据批准后，才能进入 `accepted-with-known-gaps`；不得把 frontend build 描述为 UI 已验证。

## 7. 知识新鲜度

当前 `backend`、`frontend` 和 `common` 均为 `stale-or-incomplete`。它们是当前 Story 的预期相关区域，不是初始化前的固定强制清单。M7-D 必须通过正式 State 流程确定并处理实际 relevant area：

```text
初始化 Story
-> 完成 requirement
-> prepare technical-design
-> 确定 affectedAreas 和 relevant areas
-> 逐 relevant area 执行 check-knowledge
-> refresh 或逐项 approve-stale
-> apply technical-design
```

只有 `affectedAreas` 实际映射到 `common`、`backend` 或 `frontend` 时，对应区域才进入当前 Story 门禁。根据已选真实业务，预计三个区域都会相关；最终以 technical-design result 的结构化 `affectedAreas` 为准。

对实际 relevant area 默认采用刷新：

```text
common -> all-area baseline refresh
backend -> backend baseline refresh
frontend -> frontend baseline refresh
```

Runtime 必须按现有 protected area 和回执语义执行，避免重复或冲突刷新。刷新后重新检查 source fingerprint、index、日志和 `custom/` 完整性。

只有刷新确实失败或无法立即完成时，才允许对具体 area 请求 `accepted-stale`。每个 area 独立批准，不允许一次批准覆盖全部区域。

真实 Story 完成后，根据业务源码变化再次刷新相关知识并同步目标基线。技术设计阶段已经通过的 freshness snapshot 保留其历史时点语义，不因实现后的正常源码变化被改写。

## 8. 正式九阶段执行

真实 Story 使用新 Story ID 和正式 State v2 初始化，不修改历史 M6-A State：

```text
requirement
-> technical-design
-> task-dag
-> implementation
-> unit-test
-> code-review
-> build-publish
-> interface-verification
-> delivery-preparation
-> done
```

执行要求：

- 每次继续前使用 `run-e2e Status` 获取唯一下一动作。
- cognitive action 由当前 Codex 会话完成，首版不启动 Agent Provider。
- 阶段 result 使用统一 v2 契约，并绑定 Markdown output 的路径和 SHA-256。
- task DAG 的 `dag.nodes` 是唯一任务事实源。
- 业务实现按 TDD，先形成失败测试，再做最小实现。
- code review 使用独立只读 Agent，不让审核 Agent 修改文件。
- build-publish 只执行本地构建，不发布。
- interface verification 如实记录环境事实。
- delivery-preparation 不执行 Git。
- 最终运行 State 核验器，成功后才能声明真实 Story 闭环通过。

真实 Story 不强制制造 block、gap 或 accepted-stale。只有真实发生时才进入对应分支。

## 9. 错误与恢复

- acceptance fixture 失败：保留失败输出，修复对应既有 Runtime 或测试缺陷后重跑；不跳过场景。
- 核验器发现缺失事实：回到产生该事实的正式阶段修复；completed State 不允许原地修改。
- 如果真实 Story 已错误进入 completed 且事实不完整：M7-D 验收失败，创建新的修复 Story，不改写 completed State。
- result、output、evidence、approval 或 State 哈希漂移：失败关闭。
- 知识刷新失败：保持当前 technical-design attempt，重试刷新或逐 area 请求批准。
- 后端测试失败：implementation 或 unit-test 不得推进。
- code review 存在 BLOCKER/WARNING：修复并重新测试、重新审核。
- 构建失败：不得进入 interface-verification。
- UI 环境不可用：记录 blocked；不得伪造 verified。
- 当前仓库存在无关 dirty files：不得将其归入 Story owned files，也不得还原。
- completed State 后没有 Git commit：合法保持 `gitStatus=not-requested`。

## 10. TDD 与实施顺序

M7-D 不改变现有业务语义前，先为验收资产编写 RED：

1. final-State verifier 对完整 State 通过、缺失核心事实失败的测试。
2. final-State verifier 对绝对路径、`..`、symlink、junction、仓库外 realpath 和错误文件类型失败的测试。
3. M7-D acceptance 测试对七类异常的纵向场景。
4. PowerShell 核验器参数、JSON 输出和退出码测试。
5. 运行现有 Runtime 回归，确认新增验收层没有改变既有协议。
6. 初始化真实 Story，完成 requirement，并 prepare technical-design。
7. 确定 affected/relevant areas，通过 M7-C 正式接口完成知识检查、刷新或逐项批准。
8. 完成 technical-design 和 DAG。
9. 为阅读状态筛选编写后端失败测试。
10. 做最小后端实现并运行定向测试。
11. 做最小前端实现并运行构建。
12. 完成独立代码审核、构建和真实界面验证。
13. 完成交付准备、最终 State 核验和 M7-D 报告。

如果 RED 立即通过，必须确认测试是否真的覆盖新增验收要求；不得仅为满足形式而修改无关生产代码。

## 11. 验收门禁

### 11.1 Fixture 门禁

- M7-D 专项 acceptance 测试全部通过。
- 现有 State、Story、E2E、Knowledge、Approval 和 Delivery Runtime 回归通过。
- v1 历史 State 保持只读兼容且内容不变。

### 11.2 真实 Story 门禁

- 使用 State v2 和统一串行入口完成九阶段。
- 所有 required criterion 被 DAG、测试和最终验证覆盖。
- relevant knowledge 为 fresh 或具有逐项 accepted-stale。
- 后端定向测试和必要回归通过。
- frontend build 通过。
- 独立代码审核无未解决 BLOCKER/WARNING。
- UI 验证为 verified，或具体 case 获得逐项 accepted-with-known-gaps。
- delivery preparation 正确区分 owned、predicted-but-unchanged、unexpected 和 initial dirty files。
- Story 在未请求 Git 时合法进入 `done/completed`。
- final-State verifier 返回 `passed`。

### 11.3 M7 完成门禁

- fixture 和真实 Story 两类验收均通过。
- 仅读取最终 State 可以回答需求、决策、知识、DAG、修改、测试、审核、构建、验证、缺口和交付准备事实。
- M7-D `REPORT.md` 记录命令、结果、真实缺口和剩余风险。
- 目标基线、结构清单、交接文档和知识状态同步。
- Harness 结构校验、State/DAG 校验和 `git diff --check` 通过。
- 独立最终审核无未解决 BLOCKER/WARNING。
- 未经用户批准不执行当前仓库的 Git 暂存、提交或推送。
- 用户批准后才进入 M8。

## 12. 预计修改范围

验收层：

```text
.harness/scripts/lib/story-closure-verifier.mjs
.harness/scripts/verify-story-closure.ps1
.harness/scripts/tests/story-closure-verifier.test.mjs
.harness/scripts/tests/m7d-closure-acceptance.test.mjs
.harness/structure-manifest.yaml
```

里程碑文档：

```text
docs/harness-m7d-closure-acceptance/DESIGN.md
docs/harness-m7d-closure-acceptance/PLAN.md
docs/harness-m7d-closure-acceptance/REPORT.md
```

真实 Story 的预计业务范围：

```text
backend/src/main/java/com/frontierscan/article/ArticleController.java
backend/src/main/java/com/frontierscan/article/ArticleService.java
backend/src/main/java/com/frontierscan/article/ArticleRepository.java
backend/src/test/java/com/frontierscan/article/
frontend/src/api/articles.ts
frontend/src/views/DashboardView.vue
```

最终同步范围：

```text
docs/harness-engineering-target-and-gap.md
docs/harness-structure-checklist.md
CODEX-CROSS-SESSION-HANDOFF.md
llm-knowledge/
```

实际文件以 task DAG、阶段 result 和 Git 差异为准。未出现在实际修改中的 predicted file 不得自动归为 owned。

## 13. 设计完成标准

- M7-D 是验收层而不是新 Runtime 平台。
- 七类异常场景均有机器可执行的纵向验收。
- 最终 State 核验器只依赖正式结构化事实。
- Git receipt 与 completed State 保持独立。
- 真实 Story 限定为 Dashboard 阅读状态筛选。
- Favorites、批量操作、未读计数和迁移明确不在范围内。
- frontend build 与真实 UI 验证语义明确区分。
- backend、frontend、common stale 知识具有明确处理顺序。
- 所有外部副作用和 Git 写操作继续受用户逐次批准控制。
