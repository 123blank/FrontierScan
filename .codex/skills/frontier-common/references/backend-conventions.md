# Backend Conventions

Backend stack:

- Spring Boot 3.3.5
- Java 17
- Maven
- PostgreSQL
- Redis
- Flyway
- Spring Security
- JPA and MyBatis-Plus

Guidance:

- Prefer focused changes under task-owned files.
- Add or update backend tests for backend/data behavior changes.
- Keep migration changes explicit and reviewed.
- Do not copy secrets from configuration into docs or logs.
