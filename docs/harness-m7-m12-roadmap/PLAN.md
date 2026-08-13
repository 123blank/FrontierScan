# FrontierScan Harness M7-M12 迭代开发实施计划

> **供代理式开发者使用：** 每个子里程碑必须先创建并批准独立 `DESIGN.md` 和 `PLAN.md`，再使用 `superpowers:test-driven-development` 与串行实施流程完成。不得把本总计划理解为一次性实现授权。

**目标：** 按严格依赖顺序完成 State v2、确定性串行驱动、知识闭环、真实 Provider、条件式并行、Fork-Join、本地 DevOps 和首版评估。

**架构：** 保留 v1 历史兼容，为新 Story 建立 v2 State 和统一 phase result；由 Runtime 决定流程、校验和投影，AI 只承担认知任务，外部副作用保持逐次批准。

**技术栈：** Node.js ESM、PowerShell 5.1、JSON Schema 2020-12、Git、Docker Compose、Maven、Vue/Vite、现有 Harness Skill 与 Runtime。

---

## 1. 执行原则

- 技术子里程碑按依赖串行启动；前一主里程碑真实验收通过后才开始下一主里程碑实现。
- 当前总计划只提供路线，不授权执行 Git、Worktree、Docker、发布或外部写操作。
- 每个里程碑先建立 `docs/harness-<milestone>/DESIGN.md` 和 `PLAN.md`。
- 每项 Runtime 行为先写 RED，再做最小 GREEN，最后运行范围回归。
- 不重写 v1 历史状态，不修改 M6-A completed State。
- 不为尚未启动的里程碑预建空 Schema、空 Runtime 或空 Agent。

## 2. M7-A1：State v2 契约与版本共存

### 2.1 计划资产

启动时创建：

```text
docs/harness-m7a1-state-v2/DESIGN.md
docs/harness-m7a1-state-v2/PLAN.md
docs/harness-m7a1-state-v2/REPORT.md（实施后）
```

预计修改区域：

```text
.harness/schemas/e2e-state-v2.schema.json
.harness/states/e2e-state-v2.template.json
.harness/workflows/e2e-development-v2.yaml
.harness/scripts/lib/state-runtime.mjs
.harness/scripts/run-state.ps1
.harness/scripts/validate-state.ps1
.harness/scripts/tests/state-runtime.test.mjs
.harness/structure-manifest.yaml
frontier-state-runner Skill 与相关文档
```

### 2.2 实施任务

- [ ] 编写 v1 completed State 只读兼容测试，证明 `status/validate` 成功且写命令失败。
- [ ] 编写 v2 模板结构 RED：拒绝顶层 `tasks`、缺少 baseline、混入 v1 runtime.blocked 或空必需对象。
- [ ] 定义 v2 Schema、模板和工作流，工作流末阶段使用 `delivery-preparation`。
- [ ] 将 init 默认切换到 v2 模板，并在初始化锁内冻结 HEAD、branch 和 initial dirty paths。
- [ ] 在 State Runtime 增加版本分发；v1 保持原验证语义，v2 使用严格验证。
- [ ] 将 `runtime.blocked` 替换为 v2 `activeBlock`，v1 字段继续只读。
- [ ] 更新 PowerShell validator，使其按 `schemaVersion` 调用对应结构校验。
- [ ] 增加错误版本、混合字段、基线漂移和非 Git 仓库初始化测试。
- [ ] 运行 v1 全量回归、v2 新测试、结构校验和 smoke。
- [ ] 完成独立审核和真实 Harness Story 验收。

### 2.3 验收标准

- 新 Story 默认生成 v2 State。
- M6-A v1 State 字节内容不变且可读取。
- v1 的 `record/next/block/resume/complete` 明确拒绝。
- v2 不存在顶层 `tasks`，节点只存在于 `dag.nodes`。
- v2 非 blocked 状态的 `activeBlock` 必须为 null。
- baseline 能区分初始化前 dirty files。

## 3. M7-A2：统一 phase result 与 State 投影

### 3.1 计划资产

```text
docs/harness-m7a2-phase-result/DESIGN.md
docs/harness-m7a2-phase-result/PLAN.md
docs/harness-m7a2-phase-result/REPORT.md（实施后）
```

预计修改区域：

```text
.harness/schemas/dispatch-result-v2.schema.json
.harness/scripts/lib/dispatch-contract.mjs
.harness/scripts/lib/story-runtime.mjs
.harness/scripts/lib/state-runtime.mjs
.harness/scripts/tests/story-runtime.test.mjs
.harness/scripts/tests/state-runtime.test.mjs
各阶段模板和 Skill
```

### 3.2 实施任务

- [ ] 为 v2 result 公共字段、output 哈希、preparedRevision 和 payload 判别写 Schema RED。
- [ ] 为九个阶段分别写缺少 payload、错误 payload、未知字段和身份漂移测试。
- [ ] 扩展 dispatch contract，仅 v2 使用新 payload；保留 v1/v1.1/v1.2。
- [ ] 扩展 prepare，为 v2 生成绑定 State revision 的 task/action package。
- [ ] 实现 result output 的路径、SHA-256 和 bytes 对账。
- [ ] 实现纯函数式 State projector：输入旧 State 与 result，输出候选新 State。
- [ ] apply 在锁内重新读取 State、验证 result 和 outputs、计算投影并原子提交。
- [ ] 将 required output 自动证据与 result records 统一去重。
- [ ] 为 apply 中断、重试、result 漂移和重复 apply 编写恢复测试。
- [ ] 更新各阶段模板，使 Markdown 与 v2 result 同时产出。
- [ ] 运行 Dispatcher、State、Worker 和现有 batch/wave 回归。

### 3.3 验收标准

- Runtime 不读取 Markdown 内容来获取核心事实。
- result 和 State revision 不匹配时零写入。
- 相同 result 重试幂等。
- 每个阶段投影字段完整，可从 State 直接查询。
- v1 Dispatcher 和 M5 现有协议不回归。

## 4. M7-A3：验收追踪与语义门禁

### 4.1 计划资产

```text
docs/harness-m7a3-acceptance-gates/DESIGN.md
docs/harness-m7a3-acceptance-gates/PLAN.md
docs/harness-m7a3-acceptance-gates/REPORT.md（实施后）
```

### 4.2 实施任务

- [x] 为验收项唯一 ID、DAG criterion 引用和悬空引用写 RED。
- [x] 扩展 requirement result 和 task DAG v2 契约。
- [x] 更新 requirement 与 DAG 生成 Skill，要求稳定 criterion IDs。
- [x] 扩展测试/验证 case，使其引用 criterion IDs。
- [x] 实现 requirement、DAG、implementation、test、review、verification 和 completion 语义门禁。
- [x] 实现 TDD method/exception 结构和非空例外理由门禁。
- [x] 新增专用 approval 结构，绑定 subject ID 和证据哈希。
- [x] 实现逐项 `accepted-with-known-gaps` 门禁，并建立可由 M7-C 复用的通用 approval 契约；本阶段不启用 `accepted-stale` 业务门禁。
- [x] 验证重复批准、证据或结果变化后直接重新批准、理由变化、新批准替换当前 result 引用以及 approve/apply 并发串行化；拒绝和撤销语义不在 A3 首版范围。
- [x] 增加“无关 passed test 不能满足验收项”的回归测试。
- [x] 更新 case derivation，删除自由文本占位输出，改为结构化 pending draft 或要求上游补齐。

### 4.3 验收标准

- 每个 required criterion 被 DAG、测试和最终验证覆盖。
- 悬空或重复 ID 阻止推进。
- 未批准的 verification gap 阻止完成；knowledge stale 与 `accepted-stale` 完成门禁由 M7-C 启用。
- blocked 不能作为 verified。
- 仅文字声明 TDD 而没有覆盖映射不能满足测试门禁。

## 5. M7-A4：运行时一致性与交付语义

### 5.1 计划资产

```text
docs/harness-m7a4-runtime-delivery/DESIGN.md
docs/harness-m7a4-runtime-delivery/PLAN.md
docs/harness-m7a4-runtime-delivery/REPORT.md（实施后）
```

预计修改区域：

```text
.harness/scripts/lib/state-runtime.mjs
.harness/scripts/summarize-delivery.ps1
.harness/scripts/run-delivery.ps1（只记录事实）
.harness/schemas/delivery-receipt.schema.json
.harness/scripts/tests/state-runtime.test.mjs
新增 delivery runtime 测试
```

### 5.2 实施任务

- [ ] 为证据 semantic key 和重复 record 写幂等 RED。
- [ ] 修改 resume：清空 v2 activeBlock，事件和 logs 保留历史。
- [ ] 为 baseline HEAD、initial dirty、已提交变更和未提交变更构造 Git fixture。
- [ ] 重写 owned files 推导：baseline diff + DAG predicted files + result actual files。
- [ ] 将预测外修改和 unrelated initial dirty 分别报告。
- [ ] 删除 v2 completion 对 Git approval 的依赖。
- [ ] 定义只读 Git 对账和 delivery receipt Schema。
- [ ] 实现记录回执命令：验证 completed State、commit、owned files 和可选 push 事实，不执行 Git。
- [ ] 覆盖伪造 commit、错误 parent、缺少 owned file、错误 remote/ref 和回执重试。
- [ ] 回归 v1 git-delivery 历史读取，不改变 v1 状态。

### 5.3 验收标准

- 无 Git 请求时可以进入 done。
- 完成 State 保持不可变。
- Story 前 dirty files 不进入 owned files。
- 业务文件能被正确归属。
- 交付回执只能记录真实 Git 事实。

## 6. M7-B：最小确定性串行驱动器

### 6.1 计划资产

```text
docs/harness-m7b-serial-driver/DESIGN.md
docs/harness-m7b-serial-driver/PLAN.md
docs/harness-m7b-serial-driver/REPORT.md（实施后）
```

预计新增入口：

```text
.harness/scripts/run-e2e.ps1
.harness/scripts/lib/e2e-runtime.mjs
.harness/scripts/tests/e2e-runtime.test.mjs
```

### 6.2 实施任务

- [ ] 定义 action package 与返回动作类别 Schema。
- [ ] 实现 `Status`：只读返回当前阶段、缺失输入、可执行动作和批准需求。
- [ ] 实现 `Step`：执行允许的确定性动作，认知任务返回 `cognitive-action-required`。
- [ ] 实现 `Apply`：消费 v2 result，调用现有 Story/State Runtime 完成投影和推进。
- [ ] 固定 Adapter 白名单，不接受模型生成 shell。
- [ ] 覆盖重复 Step、断电恢复、结果缺失、批准缺失和阶段已变化。
- [ ] 在 smoke 中加入完整 v2 串行 fixture。
- [ ] 使用新的 Harness 结构 Story 完成真实串行验收。

### 6.3 验收标准

- 新会话仅读取 State 即可得到唯一下一动作。
- 认知任务不会被脚本伪装为已完成。
- 批准点必定停止。
- 重试不重复推进或重复记录。
- 首版不调用任何真实 Agent Provider。

## 7. M7-C：知识新鲜度闭环

### 7.1 计划资产

```text
docs/harness-m7c-kb-freshness-loop/DESIGN.md
docs/harness-m7c-kb-freshness-loop/PLAN.md
docs/harness-m7c-kb-freshness-loop/REPORT.md（实施后）
```

### 7.2 实施任务

- [ ] 为 relevant area 推导和 freshness State 投影写 RED。
- [ ] 将 freshness 脚本增加稳定 JSON 输出，不改变默认只读行为。
- [ ] 生成 module/area 级最小 refresh task。
- [ ] 调用现有 generate-kb 能力并重验 fingerprint、index 和 log。
- [ ] 对刷新前后 `custom/` 做内容哈希保护。
- [ ] 实现 accepted-stale 的逐 area 批准门禁。
- [ ] 覆盖未涉及区域 stale、不完整刷新、custom 漂移和重验失败。
- [ ] 使用一个包含真实 stale 的 Story 完成闭环验收。

### 7.3 验收标准

- freshness 进入 State。
- 只刷新相关最小范围。
- stale 不被错误标记为 fresh。
- accepted-stale 有逐项用户证据。
- 刷新不会覆盖人工知识。

## 8. M7-D：双重闭环验收

### 8.1 计划资产

```text
docs/harness-m7d-closure-acceptance/DESIGN.md
docs/harness-m7d-closure-acceptance/PLAN.md
docs/harness-m7d-closure-acceptance/REPORT.md（验收后）
```

### 8.2 Fixture

- [ ] block/resume。
- [ ] accepted gap。
- [ ] accepted stale。
- [ ] result 漂移和重复 apply。
- [ ] 阶段中断恢复。
- [ ] 无 Git 完成。
- [ ] 完成后记录 Git receipt。

### 8.3 真实 Story

- [ ] 选择范围小、验收清晰且能运行真实测试的业务。
- [ ] 使用 State v2 和串行驱动完成九阶段。
- [ ] 真实发生的缺口如实记录，不制造阻塞。
- [ ] 最终编写机器核验脚本，仅读取 State 回答闭环事实。
- [ ] 更新目标基线、交接、结构清单和知识。

### 8.4 M7 完成门禁

- State v2 与串行驱动通过真实业务验收。
- 相关知识 fresh 或逐项 accepted-stale。
- 独立审核无 BLOCKER/WARNING。
- 用户批准进入 M8。

## 9. M8-A：只读审核 Provider

### 9.1 计划资产

```text
docs/harness-m8a-review-provider/DESIGN.md
docs/harness-m8a-review-provider/PLAN.md
docs/harness-m8a-review-provider/REPORT.md（实施后）
```

### 9.2 实施任务

- [ ] 调研当前 Codex 可验证的非交互 Provider 调用方式和权限边界。
- [ ] 定义 provider request、context manifest、response 和 usage metadata。
- [ ] 复用 Worker policy，首个角色只允许 `code-reviewer`。
- [ ] 禁止 candidate business files、Git、发布和 State 写入。
- [ ] 实现超时、输出大小、非法 JSON、额外字段和中断恢复。
- [ ] Runtime 校验后写正式 review result。
- [ ] 在真实 Story 中同时执行人工审核和 Provider 审核，比较有效发现。

### 9.3 验收标准

- Provider 无法修改业务代码或 State。
- Provider 失败不污染正式结果。
- 替换 Provider 不改变 phase result 和 State 契约。
- 至少一个真实审核任务证明其结果有实际价值。

## 10. M8-B：单任务开发 Provider

### 10.1 计划资产

```text
docs/harness-m8b-development-provider/DESIGN.md
docs/harness-m8b-development-provider/PLAN.md
docs/harness-m8b-development-provider/REPORT.md（实施后）
```

### 10.2 实施任务

- [ ] 为 backend/frontend developer 定义受限写策略。
- [ ] 只允许单任务、单 Worktree、串行执行。
- [ ] 输入冻结 DAG node、predicted files、知识和继承快照。
- [ ] 候选文件必须匹配 role capability 和 predicted files。
- [ ] Runtime 收集、测试和受控集成，Provider 不直接修改主树。
- [ ] 覆盖越权路径、部分输出、超时、重试和候选漂移。
- [ ] 用真实小任务完成 Provider 开发验收。

### 10.3 验收标准

- 无越权写入。
- 主树只通过受控集成改变。
- 失败后可重试且输入保持一致。
- 用户批准进入 M9。

## 11. M9：条件式单 Story 并行

### 11.1 计划资产

```text
docs/harness-m9-conditional-parallel/DESIGN.md
docs/harness-m9-conditional-parallel/PLAN.md
docs/harness-m9-conditional-parallel/REPORT.md（实施后）
```

### 11.2 实施任务

- [ ] 在调度器中实现并行资格判定，默认返回建议而非自动创建。
- [ ] 复用 M5-D WavePlan/WaveCreate/execute/integrate/retire。
- [ ] 将 Mock Provider 替换为已验收的真实 Provider。
- [ ] 全局变化和共享文件任务自动转为串行 wave。
- [ ] Worktree create/retire 继续逐次批准。
- [ ] 覆盖同文件冲突、部分失败、attempt 恢复和串行集成。
- [ ] 使用至少两个真正独立任务的真实 Story 验收。

### 11.3 验收标准

- 不符合条件时稳定回退串行。
- 并行结果与串行语义一致。
- 主树无覆盖、丢文件或越权 Git。
- 用户批准进入 M10。

## 12. M10：多 Story Fork-Join

### 12.1 计划资产

```text
docs/harness-m10-fork-join/DESIGN.md
docs/harness-m10-fork-join/PLAN.md
docs/harness-m10-fork-join/REPORT.md（实施后）
```

### 12.2 实施任务

- [ ] 定义 Product State v2 和产品级验收项。
- [ ] 实现自然拆分判断和 Fork-Join 建议，不自动启动。
- [ ] 用户确认后初始化多个 E2E v2 State。
- [ ] 为集成分支和产品级 Worktree 操作增加逐次批准。
- [ ] Fork 到 code review，Join 串行集成、构建、验证和交付准备。
- [ ] 共享文件和全局变化提前串行。
- [ ] 覆盖子 Story 失败、冲突、部分 Join 和恢复。
- [ ] 使用真实多 Story 产品请求验收。

### 12.3 验收标准

- Product State 能解释每个 Story 和产品验收项。
- 子 Story 失败不会产生整体成功。
- Join 无破坏性冲突处理。
- 用户批准进入 M11。

## 13. M11：本地 Docker Compose DevOps 闭环

### 13.1 计划资产

```text
docs/harness-m11-local-devops/DESIGN.md
docs/harness-m11-local-devops/PLAN.md
docs/harness-m11-local-devops/REPORT.md（实施后）
```

### 13.2 实施任务

- [ ] 定义 environment plan、状态和 receipt。
- [ ] 根据 changed files、迁移和验收项生成 build/up/verify/down 计划。
- [ ] build、up、down 分别请求用户批准。
- [ ] 等待四个服务健康并记录超时诊断。
- [ ] 运行数据库迁移、API 用例和浏览器 UI 用例。
- [ ] 只收集任务相关日志，限制大小并避免敏感数据。
- [ ] 中断后从环境事实恢复，不重复破坏环境。
- [ ] 使用真实业务完成完整本地环境闭环。

### 13.3 验收标准

- Compose 环境能够受控启动、验证和关闭。
- 环境不可用被记录为 blocked。
- API/UI 结果绑定验收项。
- 不访问生产或外部平台。
- 用户批准进入 M12。

## 14. M12：评估与持续改进

### 14.1 计划资产

```text
docs/harness-m12-evaluation/DESIGN.md
docs/harness-m12-evaluation/PLAN.md
docs/harness-m12-evaluation/REPORT.md（评估后）
```

### 14.2 数据采集

从 M7 起在不改变业务门禁的情况下记录：

```text
story completion
phase failure/retry/recovery
gate findings
user decisions and approvals
accepted gaps/stale
policy violations
unrelated file contamination
```

### 14.3 实施任务

- [ ] 定义 evaluation event 和 report Schema。
- [ ] 从 State、events 和 receipts 确定性聚合，禁止读取聊天记录作为指标源。
- [ ] 为重复事件、缺失 Story 和版本混合写聚合测试。
- [ ] 累计至少 5 个真实 Story。
- [ ] 生成首版基线报告和高频人工介入分析。
- [ ] 将改进建议作为待批准 backlog，不自动修改规则。

### 14.4 验收标准

- 所有指标可追溯。
- 5 个 Story 覆盖至少两种任务类型。
- 越权、伪造验证和无关文件污染目标为零。
- 首版不因缺少 Token/费用数据判定失败。
- 自进化继续延期。

## 15. 每个里程碑的通用验证

至少运行：

```powershell
node .\.harness\scripts\tests\state-runtime.test.mjs
node .\.harness\scripts\tests\story-runtime.test.mjs
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.harness\scripts\validate-structure.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.harness\scripts\smoke-harness-flow.ps1
git diff --check
```

按修改范围补充 Worker、Worktree、知识、后端、前端和 Docker 验证。不得用部分测试结果宣称全部通过。

## 16. 文档与交付规则

- 每个里程碑实施后创建中文 `REPORT.md`。
- 更新 `docs/harness-engineering-target-and-gap.md` 的证据、差距和下一步。
- 更新 `docs/harness-structure-checklist.md`。
- 更新 `CODEX-CROSS-SESSION-HANDOFF.md` 和必要知识概览。
- Harness 结构变化后运行结构校验。
- 暂存、提交和推送继续分别获得用户明确批准。
