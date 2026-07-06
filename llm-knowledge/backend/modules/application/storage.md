# Backend Storage

Scope:

- `backend/src/main/resources/db/migration`
- `backend/src/main/resources/application.yml`
- Persistence-related Java packages under `backend/src/main/java/com/frontierscan`

Known storage technologies:

- PostgreSQL for durable relational data
- Redis for cache or auxiliary task state
- Flyway for schema migrations

Future generated sections should include:

- Tables and migrations
- Entity/model mapping
- Repository/mapper usage
- Redis key conventions
- Data consistency risks
