# Parallelization Policy

Parallelism is allowed only when tasks are independent and conflict risk is low.

## Safe To Parallelize

- Separate backend controllers/services with no shared files.
- Separate frontend views/components with no shared CSS/router/store changes.
- Documentation-only tasks independent from code tasks.
- Test additions that do not modify the same test file.

## Do Not Parallelize

- Tasks predicted to touch the same file.
- Tasks that both modify shared frontend styles.
- Tasks that both modify router, auth store, API client base behavior, or app layout.
- Tasks that both modify database migrations.
- Tasks that depend on a new backend API contract.

## Wave Rules

- Put global/shared changes in the earliest serial wave.
- Put dependent frontend work after backend/API contract work.
- Put test-only tasks after the behavior they test unless they are intentionally TDD-first.
- If uncertain, serialize and record the reason in `risks`.
