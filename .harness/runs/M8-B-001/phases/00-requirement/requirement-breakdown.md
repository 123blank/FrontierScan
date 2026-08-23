# M8-B-001 需求拆解

## 目标

在已完成的 M8-A 只读 `code-reviewer` Provider、M5 单 Worktree 与内容寻址集成、M7 State v2 串行闭环之上，接入单任务、单隔离 Worktree、串行执行的真实开发 Agent Provider。

采用方案 B：`backend-developer` 或 `frontend-developer` 由 Runtime 冻结任务、知识、角色、模型和 Worktree 边界后，以固定 `workspace-write` 在任务 Worktree 中直接修改文件。Runtime 根据实际文件系统与 Git 差异收集候选，执行固定测试，通过 M5-B2 受控集成写入主工作树，最后由 Story Runtime 应用正式 implementation result。

## 验收标准

### AC-M8B-REAL-DEVELOPER

Harness 能在当前有效 State v2 `implementation` attempt 中，通过真实 `codex exec` 启动单个 `backend-developer` 或 `frontend-developer`，并让 Agent 直接修改任务专属 Worktree。

### AC-M8B-WORKTREE-ONLY

Agent 的工作目录和 `workspace-write` 边界固定为已批准的单任务 Worktree；Agent 不直接修改主工作树、State、正式阶段结果或 Git 历史，Runtime 不夸大为逐文件 ACL 或绝对 Git 隔离。

### AC-M8B-PREDICTED-FILE-GATE

Runtime 根据执行前后快照、Git 事实、角色策略、DAG `predictedFiles` 和 Agent 声明对账候选；计划外、跨角色、删除、重命名、symlink、二进制或不可解释变化使整个 attempt 失败关闭。

### AC-M8B-CANDIDATE-TEST

候选冻结后只由 Runtime 选择固定测试 Adapter；正式测试使用未被 Agent 污染的工具链，测试失败、工具链漂移或候选漂移均不得生成可集成的开发回执。

### AC-M8B-CONTROLLED-INTEGRATION

测试通过后由 Finalize 生成 implementation notes、严格 result 候选、标准 evidence 投影和 Development Provider receipt；M5-B2 按业务文件、phase output、result-last 顺序受控集成，Story Runtime 是唯一 State 推进入口。

### AC-M8B-RECOVERY

Prepare、Run、Materialize、Test、Finalize 和 Integration 使用唯一锁、claim-first、内容哈希与磁盘事实恢复；中断和重复调用不会重复启动模型、覆盖新 owner 或产生不一致正式结果。

### AC-M8B-MODEL-ROUTING

开发角色复用 M8-A 的 `role -> profile -> adapter/model` 配置与覆盖优先级；模型和 Profile 选择不能改变角色、sandbox、cwd、写入策略、CLI 参数或测试命令。

### AC-M8B-REAL-STORY

专项 fixture、回归和独立审核通过后，至少一个真实 backend 单任务 Story 使用 Development Provider 完成九阶段闭环并进入 `done/completed`；不要求自动 Git、提交、推送、发布或部署。

## 范围内

- `backend-developer` 与 `frontend-developer` 的 Codex CLI 角色路由。
- Development request、context、response、execution、candidate、test 和 receipt 严格契约。
- `Status/Prepare/Run/Materialize/Test/Finalize` Runtime 与 E2E 下一动作映射。
- 单任务 Worktree 中的直接代码修改、候选对账、可信固定测试和失败恢复。
- Development receipt 到 M5-B2 candidate source 的严格归一化。
- development source 的 integration plan v1.1 与 legacy v1.0 兼容。
- 正式 evidence 投影、implementation result 五字段契约和 result-last 时序。
- fixture、回归、独立审核、真实 Codex CLI 验收和一个真实 backend Story。

## 范围外

- 多任务、多 Worktree、同 wave 并行和多 Story Fork-Join。
- 自动创建、reset、clean、删除或回收 Worktree。
- Agent 直接修改主工作树、State、Git 历史或外部系统。
- 删除、重命名、symlink、submodule、嵌套 Git 和二进制候选。
- 模型生成任意 shell 后由 Runtime 执行。
- `openai-compatible`、阿里百炼 HTTP Adapter 或其他外部 Provider Adapter。
- 自动 `git add`、`git commit`、`git push`、PR、发布或部署。
- 生产环境、云控制面、多租户和恶意本地进程级强隔离。

## 开放问题

无。方案 B、模型路由、安全边界、State v2 兼容、M5-B2 集成和真实验收范围均已写入 `docs/harness-m8b-development-provider/DESIGN.md`，并通过独立只读审核。
