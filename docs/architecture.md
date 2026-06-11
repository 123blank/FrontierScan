# 架构说明

## 概览

FrontierScan 采用前后端分离架构。

- Vue 负责用户界面，通过 `/api` 前缀调用 REST API。
- Spring Boot 负责认证、领域 API、采集任务、大模型集成和可观测性。
- PostgreSQL 存储用户、分类、网站、文章和任务数据。
- Redis 预留用于任务锁、限流和缓存场景。
- Docker Compose 提供单机部署方案。

## 后端模块

- `auth`：登录与 JWT Token 处理。
- `category`：用户维护的信息分类。
- `site`：信息源网站配置。
- `article`：已采集和摘要处理的内容。
- `collection`：手动与定时采集任务。
- `llm`：DashScope/Qwen 大模型 Provider 抽象，支持未来扩展。
- `common`：统一响应、异常处理和安全配置。

## 前端模块

- 登录路由支持认证功能。
- 应用布局包含侧边栏导航和顶部搜索。
- 信息看板、分类管理、网站管理和采集任务记录页面。
- API 客户端和认证状态管理已分离，可随时对接真实后端。