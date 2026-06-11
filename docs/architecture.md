# Architecture

## Overview

FrontierScan uses a frontend/backend split architecture.

- Vue renders the user experience and calls REST APIs with the `/api` prefix.
- Spring Boot owns authentication, domain APIs, collection jobs, LLM integration, and observability.
- PostgreSQL stores user, site, category, article, and task data.
- Redis is reserved for task locks, rate limiting, and cache use cases.
- Docker Compose provides a single-machine deployment path.

## Backend Modules

- `auth`: login and future token handling.
- `category`: user-maintained source categories.
- `site`: source website configuration.
- `article`: collected and summarized content.
- `collection`: manual and scheduled collection runs.
- `llm`: provider abstraction for DashScope/Qwen and future models.
- `common`: shared response, error handling, and framework utilities.

## Frontend Modules

- Login route for future authentication.
- App layout with sidebar navigation and top-level search.
- Dashboard, category management, site management, and collection run pages.
- API client and auth store are already separated for later real API integration.
