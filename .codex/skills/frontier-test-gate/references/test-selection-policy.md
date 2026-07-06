# Test Selection Policy

Use changed paths to choose the narrowest gates that still cover the risk.

## Path Rules

| Changed path | Required gate |
| --- | --- |
| `backend/**` | Backend tests |
| `frontend/**` | Frontend build |
| `.harness/**` | Harness structure validation |
| `.harness/states/**` or `.harness/schemas/**` | State validation |
| `.harness/templates/task-dag*` or `.harness/schemas/task-dag*` | Task DAG validation |
| `.codex/skills/**` or `.codex/agents/**` | Harness structure validation |
| `llm-knowledge/**` | Harness structure validation and at least one relevant KB query |
| docs only | No build by default; inspect links and examples |

## Escalation Rules

- If frontend calls a backend API changed in the same task, run both backend tests and frontend build.
- If a shared config, Docker, environment, auth, router, API client, or application entry file changed, prefer the broader gate.
- If a command cannot be run, record the reason, the risk, and the weakest remaining evidence.

## Selector

Use the deterministic helper first:

```powershell
.\.harness\scripts\select-tests.ps1
```

Treat its output as a baseline, then add gates for risks it cannot infer from paths.
