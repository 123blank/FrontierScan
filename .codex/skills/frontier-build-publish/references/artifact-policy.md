# Artifact Policy

Record build artifacts clearly.

## Backend

- Maven package output usually appears under `backend/target/`.
- Record artifact names and whether tests were included or skipped.
- Do not delete target artifacts unless explicitly asked.

## Frontend

- Vite build output usually appears under `frontend/dist/`.
- Record whether the build completed and any warnings.
- Do not publish `dist/` unless explicitly approved.

## Docker

- `docker compose build` can affect local Docker state.
- Treat Docker image creation as approval-required when not already explicitly requested.
