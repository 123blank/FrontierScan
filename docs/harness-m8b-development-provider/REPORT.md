# FrontierScan Harness M8-B 单任务开发 Agent Provider 实施报告

> 日期：2026-08-23
>
> 状态：已完成实现、真实 Provider fixture 和真实业务 Story 验收
>
> 设计：`docs/harness-m8b-development-provider/DESIGN.md`
>
> 计划：`docs/harness-m8b-development-provider/PLAN.md`
>
> 实施 Story：`M8-B-001`
>
> 真实业务验收 Story：`M8-B-REAL-001`
>
> 最终状态：`M8-B-001` 为 `done/completed` revision `29`

## 1. 完成范围

M8-B 在 M8-A 模型路由和 Provider 进程控制基础上，接入了单任务、单隔离
Worktree、串行的 `backend-developer` 与 `frontend-developer` Provider：

```text
Story implementation task
-> Development Provider Prepare
-> Codex CLI 在任务 Worktree 内执行
-> Runtime Materialize 候选
-> 固定 Adapter 测试
-> Development receipt
-> M5-B2 受控集成主树
-> Story Runtime Apply
```

Agent 只直接修改任务 Worktree。正式报告、result、receipt 和 State 仍由 Runtime
生成或投影；主工作树只通过 M5-B2 的内容寻址集成写入。

## 2. 主要实现

- 扩展 Provider 配置，使 backend/frontend developer 可按角色选择 Profile 和模型。
- 新增 development request、context、response、execution、candidate、test 和最终
  receipt 严格 Schema。
- 新增冻结上下文和 Worktree/Git baseline，对 role、DAG node、criterion、
  `predictedFiles`、知识状态和文件限额失败关闭。
- 扩展 `codex-cli` Adapter，以固定参数在任务 Worktree 中执行 `workspace-write`。
- 新增 `Status/Prepare/Run/Materialize/Test/Finalize` Runtime 和 PowerShell 入口。
- Runtime 从真实 Git 与文件差异生成候选，不接受 Agent 声明代替磁盘事实。
- 固定测试通过后才生成 implementation notes/result 候选和 development receipt。
- M5-B2 integration plan v1.1 支持 Development Provider 候选，并保持 result-last
  集成顺序。
- E2E Runtime 能返回 Development Provider、测试、Finalize 和受控集成的唯一下一动作。

## 3. 模型路由

M8-B 复用 M8-A 的配置优先级：

```text
Prepare 单次覆盖
-> agent-providers.local.json
-> agent-providers.json
-> defaultProfile
```

模型选择不改变角色权限、sandbox、工作目录或允许修改的文件。真实验收使用本地
`codex-custom` Profile 和 `gpt-5.6-sol`；本地端点与凭据不进入项目配置、State、
日志或交付文件。

## 4. 安全边界

首版固定以下边界：

- 只允许 `implementation` 阶段的 backend/frontend developer。
- 一次只消费一个 pending DAG node 和一个已创建的任务 Worktree。
- 不接受调用方提供任意 executable、argv、sandbox、cwd、prompt 或环境变量。
- 不允许删除、重命名、symlink、submodule 或二进制候选。
- 候选必须同时匹配 role policy 与 `predictedFiles`。
- 测试失败、候选漂移、Git 元数据漂移或身份漂移均不进入主树。
- Runtime 不自动创建、回收或删除 Worktree，不自动提交或推送。

`workspace-write` 不是针对恶意代码的完整操作系统隔离。M8-B 通过固定 Worktree、
调用前后 Git 元数据对账、候选白名单和受控集成降低风险，不声称 Agent 绝对无法
尝试 Git 操作。

## 5. 独立审核与修复

多轮只读 `code-reviewer` 审核发现并关闭了以下实际问题：

1. 固定测试进程未明确使用受限 sandbox。
2. ignored 文件对账不足，Provider 可在被忽略路径留下副作用。
3. Maven/JDK 可执行身份未充分冻结。
4. 集成计划未完整绑定 Development Provider receipt 与候选身份。
5. 中断恢复与 result-last 顺序存在可误判窗口。
6. 真实 Story 中 predicted source 同时来自 knowledge 与 DAG 时被误判为重复上下文。

第 6 项在真实业务验收中暴露。修复规则为：predicted source 优先，knowledge 中同路径
条目跳过，最终唯一性门禁继续保留。该修复通过
`development-provider-context.test.mjs` 的 RED/GREEN 用例验证。

正式 Story 在 delivery-preparation 对账时又发现旧 implementation actual files
错误包含初始化前 dirty 的结构清单、DESIGN 和 PLAN。受限 rework 将 State 返回
implementation，排除这些文件并完整重走测试、审核、构建、验收和交付准备。
同时修复 Delivery Runtime 对 `.harness/tmp/` 嵌套临时 Git 仓库尾斜杠目录的误判；
其他非规范路径仍失败关闭。

最终独立审核：

```text
BLOCKER=0
WARNING=0
```

## 6. 真实 Provider fixture

真实 Codex CLI fixture 在临时 Git 仓库和 linked Worktree 中完成：

- Agent 只修改 `backend/src/main/java/example/Service.java`。
- 固定 Maven 测试通过。
- candidate manifest、test receipt 和 development receipt 完整。
- M5-B2 受控集成后 Story Apply 成功。
- Git 探针尝试 branch、local config、add 和 commit 时，被 sandbox 拒绝或被
  Runtime Git baseline 对账识别。

正式 FrontierScan 主仓库没有为该 fixture 写入业务文件。

## 7. 真实业务 Story

`M8-B-REAL-001` 在独立临时验收仓库中实现站点字段归一化：

- 创建和更新站点时去除 `name`、`url`、`rssUrl` 首尾空白。
- 仅包含空白的 `rssUrl` 保存为 `null`。
- predicted files 仅为 `SiteService.java` 和 `SiteServiceTest.java`。

真实执行身份：

```text
dispatchId=3469be33-6ee5-401e-9fb8-794b27c45425
providerRequestId=9987c152-0864-4de0-9f51-d0ec9f53e64b
providerExecutionId=80d48e71-e3f3-4463-ab91-973a0a872ab2
```

验证结果：

- Development Provider 完成 Prepare、Run、Materialize、Test 和 Finalize。
- M5-B2 受控集成和 Story Apply 通过。
- `SiteServiceTest` 定向测试通过。
- 完整后端测试 166 项通过。
- 真实只读 code-reviewer 无 BLOCKER/WARNING。
- `mvn package` 通过并生成本地 JAR。
- 三项 required criterion 均为 `verified`。
- 最终 State 为 `done/completed` revision `10`。
- delivery 只认领两个 predicted files，`gitStatus=not-requested`。
- `verify-story-closure.ps1` 和 `validate-state.ps1` 均通过。

真实业务差异与运行证据保留在
`.harness/tmp/m8b-site-normalization-acceptance-v2`，不复制到正式业务源码。

## 8. 测试与验证

已覆盖：

- Provider config、development contract、context、Codex CLI 和 Runtime 专项测试。
- backend/frontend Development Provider 纵向 E2E。
- M5-B2 integration v1.1 和 result-last 恢复。
- Story/E2E Runtime 动作映射。
- M8-A read-only Provider 回归。
- 越权路径、删除/重命名/symlink、ignored 副作用、Git 元数据漂移、测试失败、
  输出损坏、超时、锁和中断恢复。
- 真实 Codex CLI fixture 和真实 backend Story。
- Harness 结构、知识新鲜度、State 闭包和差异检查。
- Delivery Runtime 嵌套临时仓库回归与 29 个 owned files 最终 manifest 对账。

正式实施 Story 最终为 `done/completed` revision `29`，八项 required criterion 均为
`verified`，`delivery.gitStatus=not-requested`。Delivery 对账将 4 个预测外 Harness
修复显式报告，并保留文档、知识刷新和初始化前 dirty 文件为 unrelated。

## 9. 剩余限制

M8-B 未实现：

- 同一 Story 多任务并行或多 Worktree 调度。
- 多 Story Fork-Join。
- `openai-compatible` HTTP Adapter。
- Agent 自动创建或回收 Worktree。
- 自动 Git、PR、发布、部署或生产环境写入。
- `run-e2e Step` 无人干预执行完整 Provider 链。

## 10. 下一步

下一阶段是 M9 条件式单 Story 并行设计。只有 DAG 同一 wave 至少存在两个无依赖、
文件不冲突、无共享全局变化且具有已验收 Provider 的任务时，Harness 才提出并行建议；
真实 Worktree 创建和回收继续逐次获得用户批准。
