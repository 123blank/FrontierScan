# FrontierScan Project Map

| Area | Path | Purpose |
| --- | --- | --- |
| Backend | `backend/` | Spring Boot 3 backend service |
| Frontend | `frontend/` | Vue 3 admin frontend |
| Docs | `docs/` | Human-facing docs and Harness plans |
| Knowledge | `llm-knowledge/` | AI-consumable structured project knowledge |
| Runtime state | `.harness/` | Harness state, schemas, workflows, reports, and outputs |
| Project Skills | `.codex/skills/` | Project-local Skill definitions |
| Project Agents | `.codex/agents/` | Planned role registry for future Agent implementation |

Important commands:

```powershell
Set-Location D:\ProjectStudy\FrontierScan\backend
mvn test
```

```powershell
Set-Location D:\ProjectStudy\FrontierScan\frontend
npm run build
```
