# FrontierScan - 前沿信息采集与阅读系统

FrontierScan 是一个前后端分离的技术与 AI 信息采集系统。用户维护网站和 RSS 信息源，系统定时采集文章，生成大模型摘要与结构化标签，并通过信息看板、文章详情和收藏页完成阅读闭环。

项目同时在建设 Harness Engineering 工作流，通过结构化知识、阶段状态、确定性脚本和受限模型执行器支持可追踪、可恢复的开发过程。

> 项目进展核对日期：2026-10-06。后端版本为 `0.1.0-SNAPSHOT`；以下内容以当前工作区源码与工作流状态为依据，包含尚未提交的 Harness 开发内容。

## 当前进展

| 模块 | 已实现能力 |
| --- | --- |
| 登录与隔离 | JWT 登录认证；分类、站点、文章、收藏和任务查询按用户归属校验 |
| 信息源管理 | 分类与网站管理、RSS 地址、采集间隔、启停配置 |
| 文章采集 | 手动采集、定时采集、RSS/Atom 解析、RSS 失败后 HTML 降级、规范化 URL 去重 |
| 采集可靠性 | 最多 3 次自动重试，间隔 5 / 15 / 60 分钟；手动重试、站点健康状态、失败类型与阶段定位 |
| 全文摘要 | 保存采集到的清洗正文；长文分块摘要后聚合，历史文章回退到正文片段 |
| 摘要治理 | 待生成、完成、失败、低质量状态；规则质量评分、失败原因、手动重新生成和滞留待生成摘要恢复 |
| 结构化标签 | 基于数据库领域和标签候选调用大模型评分；采集增强与手动重摘要接入标签评估 |
| 信息看板 | 默认每页 10 篇，可选 20 / 50；分类、站点、关键词、标签、日期与阅读状态筛选 |
| 阅读与收藏 | 文章详情抽屉、已读/未读状态、星标收藏与取消收藏、收藏页、采集后 12 小时内的 `new` 标记 |
| 并行增强 | 采集、文章摘要、长文 Map 分块、标签评估使用独立线程池；单篇摘要尝试结束后立即评估标签 |

### Harness 开发进展

- M7 已完成单业务状态、证据门禁、知识新鲜度和闭环验收。
- M8-A / M8-B 已完成真实只读审核执行器与单任务开发执行器的验收。
- M8-C 持久后台编排已有控制面、后台宿主、认知执行器和恢复相关实现及测试；当前活动 Story `M8-C-001` 仍处于 `implementation`。专项计划中的真实关闭客户端业务验收、最终审核和文档收口尚未完成，不能视为已完成里程碑。
- M9 条件式并行、M10 多业务 Fork-Join、M11 本地环境 DevOps 和 M12 持续评估属于后续路线。

详细进展以 [Harness 目标与差距](docs/harness-engineering-target-and-gap.md)、[演进计划](docs/harness-m7-m12-roadmap/PLAN.md)、[M8-C 实施计划](docs/harness-m8c-persistent-orchestrator/PLAN.md) 和对应结构化状态为准。

## 技术栈

| 层级 | 技术 |
| --- | --- |
| 后端 | Java 17、Spring Boot 3.3.5、Maven、Spring Security、JWT |
| 数据访问 | Spring Data JPA 与 MyBatis-Plus 3.5.12 并存；标签模块已接入 MyBatis-Plus，后续新增业务优先使用 MyBatis-Plus |
| 数据与调度 | PostgreSQL、Flyway、Redis、Spring 定时调度、CompletableFuture |
| 内容解析 | Rome RSS/Atom、Jsoup HTML |
| 大模型 | DashScope 兼容接口，默认模型 `qwen-plus` |
| 前端 | Vue 3、TypeScript、Vite、Pinia、Vue Router、Axios |
| 部署与开发工作流 | Docker Compose、Nginx；Harness 脚本使用 PowerShell 与 Node.js |

## 采集与增强流程

```text
手动触发 / 定时调度 / 到期重试
  -> 校验站点归属，创建 RUNNING 任务
  -> RSS 优先，失败后尝试 HTML
  -> 去重并保存文章全文与展示片段
  -> 多篇文章并行增强：
       单篇摘要（短文直接生成；长文并行 Map -> Reduce）
       -> 摘要规则评分与状态落库
       -> 领域评分 -> 候选标签评分 -> 结构化标签落库
  -> 汇总增强告警，更新任务记录与站点健康状态
```

摘要或标签失败只产生增强告警，不阻断文章采集成功。解析不到候选文章属于 `EMPTY_RESULT` 失败；候选文章全部重复而新增 0 篇属于成功采集。采集任务通常等待增强流水线结束后完成，批次等待设有超时兜底。

摘要优先使用 `content_full`，为空时回退 `content_excerpt`。全文指采集器实际获得的正文：RSS 只提供片段时，不能据此保证已取得原网页全文。标签使用摘要、关键要点和受控长度的正文兜底，不执行全文 Map-Reduce。

## 快速开始

### Docker Compose

需要安装 Docker 及 Docker Compose。在仓库根目录执行：

```powershell
Copy-Item .env.example .env
# 按实际环境编辑 .env，再启动服务
docker compose up --build
```

| 服务 | 地址 |
| --- | --- |
| 前端 | http://localhost:3000 |
| 后端 API | http://localhost:8080/api |
| 健康检查 | http://localhost:8080/actuator/health |
| PostgreSQL / Redis | 本机端口 `5432` / `6379` |

默认管理员为 `admin` / `admin123`，由后端初始化逻辑在账号不存在时创建。共享环境使用前请修改默认密码、数据库凭据和 `JWT_SECRET`。

当前 Compose 的 Redis 服务未配置密码，而后端配置默认使用 `123456`。若使用该无密码 Redis，需要在 Compose 的后端 `environment` 中显式设置 `SPRING_DATA_REDIS_PASSWORD: ""`；仅在 `.env` 添加该变量不会自动传入后端容器。

### 本地开发

需要 Java 17、Maven、Node.js/npm，以及可访问的 PostgreSQL 和 Redis。可仅启动数据服务：

```powershell
docker compose up -d postgres redis
```

在后端终端配置连接参数后启动。以下参数对应 Compose 默认数据服务：

```powershell
$env:SPRING_DATASOURCE_URL = 'jdbc:postgresql://localhost:5432/frontierscan'
$env:SPRING_DATASOURCE_USERNAME = 'frontierscan'
$env:SPRING_DATASOURCE_PASSWORD = 'frontierscan'
$env:SPRING_DATA_REDIS_HOST = 'localhost'
$env:SPRING_DATA_REDIS_PORT = '6379'
$env:SPRING_DATA_REDIS_PASSWORD = ''
# 使用大模型功能时设置 LLM_API_KEY；JWT_SECRET 应设置为自定义随机值
Set-Location backend
mvn spring-boot:run
```

另开终端，在仓库根目录执行：

```powershell
Set-Location frontend
npm ci
npm run dev
```

前端开发地址为 http://localhost:5173，Vite 将 `/api` 代理到本机 `8080`。本地 Maven 启动不会自动读取根目录 `.env`；请使用环境变量或 Spring 配置传入参数。数据库结构由 Flyway 启动时迁移，当前迁移为 V1–V11。

## 常用配置

配置入口为 [application.yml](backend/src/main/resources/application.yml) 和 [.env.example](.env.example)。下表列出后端支持的主要环境变量；容器运行时还需确认变量已在 Compose 后端服务中传入。

| 环境变量 | 默认值 / 用途 |
| --- | --- |
| `LLM_API_KEY` / `DASHSCOPE_API_KEY` | 大模型密钥；优先读取 `DASHSCOPE_API_KEY` |
| `LLM_BASE_URL` | `https://dashscope.aliyuncs.com/compatible-mode/v1` |
| `LLM_MODEL` | `qwen-plus` |
| `LLM_SUMMARY_MAP_REDUCE_ENABLED` | `true` |
| `LLM_SUMMARY_CHUNK_SIZE_CHARS` / `LLM_SUMMARY_OVERLAP_CHARS` | `6000` / `500` |
| `LLM_SUMMARY_MAX_CHUNKS` | `0`，不限制分块数量；长文会增加模型调用量 |
| `LLM_TAG_MAX_CONTENT_CHARS` | `8000`，标签评估正文兜底上限 |
| `COLLECTION_SCHEDULER_ENABLED` / `COLLECTION_SCHEDULER_FIXED_DELAY_MS` | `true` / `10000` |
| `SUMMARY_RECOVERY_ENABLED` / `SUMMARY_RECOVERY_FIXED_DELAY_MS` | `true` / `300000` |
| `JWT_SECRET` / `JWT_EXPIRES_IN_SECONDS` | JWT 签名密钥 / `86400` 秒 |

不配置大模型密钥仍可使用采集与阅读主流程，摘要不能正常生成，相关状态或告警会保留供排查。

## 验证命令

后端单元与集成测试：

```powershell
Set-Location backend
mvn test -q
```

前端类型检查与生产构建：

```powershell
Set-Location frontend
npm run build
```

Harness 文档、结构与知识检查，在仓库根目录执行：

```powershell
.\.harness\scripts\validate-structure.ps1
.\.harness\scripts\check-kb-freshness.ps1
```

后端测试使用 H2 测试环境；测试通过不能替代 PostgreSQL 迁移和真实模型接口的验证。后端测试报告位于 `backend/target/surefire-reports/`。

## 当前边界

- 文章目前按规范化 URL 的 `source_hash` 全局唯一。另一用户采集相同 URL 时不会新增其名下文章，现阶段尚未实现共享文章与多用户订阅关系。
- 历史文章未回填全文，重新摘要仍使用已有片段。
- 摘要质量使用规则评分，不能证明模型事实准确或不存在幻觉；低质量摘要保留供人工判断。
- MyBatis-Plus 尚未替换所有 JPA 数据访问。
- V10 全局唯一迁移遇到历史重复 `source_hash` 时会失败，需要先评估并处理重复数据。
- Harness 的角色注册表与脚手架不代表所有角色已自动调度；Git 提交、推送、发布及外部写操作仍需明确批准。

## 目录与文档

| 路径 | 用途 |
| --- | --- |
| `backend/` | API、采集、摘要、标签、认证及数据库迁移 |
| `frontend/` | 信息看板、详情、收藏、分类、网站与任务页面 |
| `docs/` | 开发说明、技术方案、交接与里程碑资料 |
| `.harness/` | 工作流、状态、执行器、证据和校验脚本 |
| `.codex/skills/` / `.codex/agents/` | 项目技能定义与角色注册表 |
| `llm-knowledge/` | 可查询的结构化项目知识 |

- [本地开发说明](docs/local-development.md)
- [架构说明](docs/architecture.md)
- [AI 交接文档](docs/AI-handover.md)：部分进展描述尚未跟随当前工作区收口，应结合源码和状态核验。
- [项目协作规范](AGENTS.md)
- [Harness 入口](.harness/README.md)与[脚本说明](.harness/scripts/README.md)
- [结构化知识入口](llm-knowledge/overview.md)
- [Harness 长期目标与差距](docs/harness-engineering-target-and-gap.md)
