# Local Development

## Backend

```powershell
cd backend
mvn spring-boot:run
```

The backend listens on `http://localhost:8080`.

Useful endpoints:

- `GET http://localhost:8080/actuator/health`
- `GET http://localhost:8080/api/ping`
- `POST http://localhost:8080/api/auth/login`

## Frontend

```powershell
cd frontend
npm install
npm run dev
```

The Vite dev server listens on `http://localhost:5173`.

## Docker

```powershell
copy .env.example .env
docker compose up --build
```

The frontend is exposed at `http://localhost:3000`, and Nginx proxies `/api` to the backend.
