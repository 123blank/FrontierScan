# 本地开发

## 后端

```powershell
cd backend
mvn spring-boot:run
```

后端启动后监听 `http://localhost:8080`。

常用端点：

- `GET http://localhost:8080/actuator/health`
- `GET http://localhost:8080/api/ping`
- `POST http://localhost:8080/api/auth/login`

## 前端

```powershell
cd frontend
npm install
npm run dev
```

Vite 开发服务器监听 `http://localhost:5173`，已配置 API 代理到后端地址。

## Docker 部署

```powershell
copy .env.example .env
docker compose up --build
```

前端通过 `http://localhost:3000` 访问，Nginx 将 `/api` 请求代理到后端服务。

## 默认管理员账号

系统启动后自动创建默认管理员：

- 用户名：`admin`
- 密码：`admin123`