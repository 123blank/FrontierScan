# M8-B-001 接口与闭环验收报告

## 结论

M8-B 八项 required criterion 均已验证。Development Provider 能在单个任务
Worktree 中执行 backend/frontend 开发，由 Runtime 对账候选、运行固定测试并生成
回执，再由 M5-B2 受控集成主树。

## 验收结果

| 验收项 | 结果 | 证据 |
| --- | --- | --- |
| `AC-M8B-REAL-DEVELOPER` | `verified` | backend/frontend fixture 与真实 Codex CLI fixture 完成 Provider 链 |
| `AC-M8B-WORKTREE-ONLY` | `verified` | Agent 只写任务 Worktree，主树只由 M5-B2 写入 |
| `AC-M8B-PREDICTED-FILE-GATE` | `verified` | 越权、删除、重命名、symlink、ignored 副作用和 Git 漂移失败关闭 |
| `AC-M8B-CANDIDATE-TEST` | `verified` | 固定测试、工具链身份和候选漂移门禁通过 |
| `AC-M8B-CONTROLLED-INTEGRATION` | `verified` | development receipt 与 integration plan v1.1 按 result-last 集成 |
| `AC-M8B-RECOVERY` | `verified` | claim-first、锁和各阶段中断恢复测试通过 |
| `AC-M8B-MODEL-ROUTING` | `verified` | Profile/模型切换未改变 sandbox、cwd、角色或测试策略 |
| `AC-M8B-REAL-STORY` | `verified` | `M8-B-REAL-001` 完成九阶段闭环，最终 revision `10` |

## 真实业务证据

`M8-B-REAL-001` 在独立临时仓库完成 SiteService 字段首尾空白归一化：

- Development Provider、M5-B2 集成和 Story Apply 通过。
- 完整后端测试 166 项通过。
- 只读审核无 BLOCKER/WARNING。
- `mvn package` 通过。
- 三项验收标准均为 `verified`。
- `verify-story-closure.ps1` 与 `validate-state.ps1` 通过。
- Git 为 `not-requested`。

## 环境与边界

本阶段验证 Harness 协议、Runtime、真实 Codex CLI 和真实 backend Story，不涉及产品
UI 修改，因此浏览器验收不适用。未执行提交、推送、发布、部署或外部环境写入。
