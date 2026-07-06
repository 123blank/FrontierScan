# Testing Conventions

Backend:

```powershell
Set-Location D:\ProjectStudy\FrontierScan\backend
mvn test
```

Frontend:

```powershell
Set-Location D:\ProjectStudy\FrontierScan\frontend
npm run build
```

Selection policy:

- Backend or data changes require relevant backend tests.
- Frontend changes require `npm run build`.
- UI changes must also be checked against B2B admin UI guidelines.
- Skipped tests must be recorded with a reason in `.harness/states/`.

Harness:

```powershell
.\.harness\scripts\validate-structure.ps1
```

```powershell
.\.harness\scripts\validate-state.ps1 -StateFile .\.harness\states\e2e-state.template.json
```

```powershell
.\.harness\scripts\validate-task-dag.ps1 -TaskDagFile .\.harness\templates\task-dag.example.json
```
