# Environment Policy

Do not fabricate interface verification.

## Before Execution

- Identify the environment: local, test, staging, or unavailable.
- Confirm backend/frontend services are running before API/UI checks.
- Confirm required auth, seed data, and external dependencies.
- If environment is unavailable, mark cases `blocked` and record why.

## Safety

- Prefer read-only requests when possible.
- For write operations, use test data only and record cleanup expectations.
- Do not modify source code during verification.
- Do not publish or deploy as part of verification.
