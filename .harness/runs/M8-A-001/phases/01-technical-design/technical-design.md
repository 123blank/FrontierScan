# M8-A-001 技术设计投影

## 设计来源

本阶段采用已经批准并通过独立只读复审的 `docs/harness-m8a-review-provider/DESIGN.md`。长期目标对应 `docs/harness-engineering-target-and-gap.md` 中的“真实受限 Agent Provider”和“程序在需要认知时调用 AI”。

`common` 知识域已在当前 HEAD `c977dae67d3117e507a1c7dfb52156368fa52cb2` 上检查为 fresh，并通过结构化知识查询核对了 State v2、Story Runtime、E2E Runtime、Worker policy 和 code-review Skill 的现有事实。

## 核心决策

1. M8-A 只开放 `role=code-reviewer`、`adapter=codex-cli`，不提前开放写入型 Agent。
2. Provider 采用 `Agent role -> Provider Profile -> Adapter/model` 路由；项目配置、本地配置和 Prepare 单次覆盖按固定优先级解析。
3. `model=null` 时不传 `--model`，只表示隔离 `codex exec` 使用其有效默认模型，不保证继承父会话临时模型。
4. Codex CLI Adapter 使用固定 argv、`read-only` sandbox、临时会话、严格输出 Schema和仓库外隔离工作目录。
5. 冻结上下文由 Runtime 构造并内联到 prompt；`read-only` 只作为写边界，不宣称严格文件读取 ACL。
6. Agent 只返回结构化 review response，不返回 candidate files；正式 evidence、报告和阶段 result 均由 Runtime 生成。
7. Provider Runtime 不直接写 State；正式 `result.json` 继续交给现有 Story Runtime 校验和投影。
8. Materialize 按 `evidence -> report -> result.json` 写入，`result.json` 是唯一提交点；成功 execution 与物化恢复不引入第二套可变工作流 State。
9. BLOCKER/WARNING 生成 blocked code-review result；Story Runtime 只为 `phase=code-review` 增加严格 payload 投影，其他 blocked phase 行为不变。
10. Prepare、Run 和 Materialize 共用 attempt/request 锁，并核对 State、task、context、Schema、Git 和文件内容完整性。

## 影响区域

- `.harness/config/`：Provider Profile 和角色绑定配置。
- `.harness/schemas/`：Provider 配置、请求、上下文、响应和 execution receipt 契约。
- `.harness/scripts/lib/`：配置、契约、上下文、Adapter、Provider Runtime 及 E2E/Story 集成。
- `.harness/scripts/tests/`：TDD fixture、回归和安全边界测试。
- `.harness/scripts/`：`run-provider.ps1` 统一入口。
- `docs/`、`.harness/README.md` 和 `llm-knowledge/common/`：最终能力与边界同步。

## 风险与控制

### RISK-M8A-WRITE-BOUNDARY

子进程可能尝试修改仓库或正式资产。控制方式是 `read-only` sandbox、仓库外工作目录、调用前后内容哈希和 Git 状态核对；任何漂移均失败关闭。

### RISK-M8A-CONTEXT-DRIFT

task、State、DAG、知识、diff 或 Schema 在 Prepare 后发生变化会让审核输入失真。request 和 manifest 绑定路径、字节数与 SHA-256，Run 和 Materialize 在锁内重新核对。

### RISK-M8A-OUTPUT-INJECTION

模型可能返回额外字段、文件、命令或越界 finding 路径。response 使用 `additionalProperties=false`，finding 只能引用 `reviewTargets`，非法输出不生成正式 result。

### RISK-M8A-RECOVERY

进程中断或多次执行可能重复调用模型、选择错误 execution 或产生半成品。采用单 request 锁、唯一成功 execution、result-last 和磁盘派生状态，自动重试保持关闭。

### RISK-M8A-MODEL-SEMANTICS

未指定模型可能被误述为继承当前父会话。执行元数据分别记录 requested、resolved、reported model 和 model source，无法确认时保持 `null`。

## 非目标

不实现 `openai-compatible`、百炼、开发 Agent、Worktree、并行、Fork-Join、自动 Git、发布、部署或生产环境访问。
