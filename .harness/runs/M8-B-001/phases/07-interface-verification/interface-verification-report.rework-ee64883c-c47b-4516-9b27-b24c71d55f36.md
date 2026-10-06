# M8-B-001 返工接口与闭环验收报告

## 结论

M8-B 八项 required criterion 继续为 `verified`。本次返工只修正正式 Story 的文件归属
和 Harness 临时仓库对账，不改变 Development Provider、Worktree、测试、集成或模型
路由协议。

## 验收结果

| 验收项 | 结果 | 当前证据 |
| --- | --- | --- |
| `AC-M8B-REAL-DEVELOPER` | `verified` | Development Provider 专项与真实 Codex CLI 证据保持有效 |
| `AC-M8B-WORKTREE-ONLY` | `verified` | Agent 只写任务 Worktree，主树由 M5-B2 受控集成 |
| `AC-M8B-PREDICTED-FILE-GATE` | `verified` | 角色策略、predicted files 和不支持变化门禁通过 |
| `AC-M8B-CANDIDATE-TEST` | `verified` | 固定测试、工具链身份和候选漂移门禁通过 |
| `AC-M8B-CONTROLLED-INTEGRATION` | `verified` | Development receipt 与 plan v1.1 result-last 集成通过 |
| `AC-M8B-RECOVERY` | `verified` | claim-first、锁和各阶段中断恢复测试通过 |
| `AC-M8B-MODEL-ROUTING` | `verified` | Profile 和模型选择不改变 sandbox、cwd、角色或测试策略 |
| `AC-M8B-REAL-STORY` | `verified` | `M8-B-REAL-001` 为 `done/completed` revision `10` |

## 返工对账

- 返工专项测试和 Harness 结构校验通过。
- 独立只读 Agent 审核无 `BLOCKER` 或 `WARNING`。
- `no-build-required` Adapter 确认 backend/frontend 没有本次返工修改。
- `M8-B-REAL-001` 三项验收仍为 `verified`，Git 为 `not-requested`。

本阶段不涉及产品 UI 修改，因此浏览器验收不适用。未执行提交、推送、发布、部署或
外部环境写入。
