# FrontierScan - 前沿信息采集 Agent

FrontierScan 是一款企业级 Web Agent 系统，用于采集、整理和展示技术/AI 前沿网站信息。

## 技术栈

- **后端**：Spring Boot 3, Java 17, Maven
- **前端**：Vue 3, TypeScript, Vite
- **存储**：PostgreSQL
- **缓存/任务辅助**：Redis
- **部署**：Docker Compose

## 本地开发

详见 [docs/local-development.md](docs/local-development.md)。

## 架构说明

详见 [docs/architecture.md](docs/architecture.md)。

## 快速开始

### Docker Compose（推荐）

```powershell
copy .env.example .env
# 编辑 .env 配置 LLM_API_KEY（可选，不配置摘要功能不可用但系统不崩溃）
docker compose up --build
```

### 本地开发

**后端**：

```powershell
cd backend
mvn spring-boot:run
```

**前端**：

```powershell
cd frontend
npm install
npm run dev
```

### 默认管理员

- 用户名：`admin`
- 密码：`admin123`