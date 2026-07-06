# Build Policy

Build only after required tests and review gates pass or risk is explicitly accepted.

## Build Gates

| Change | Build command |
| --- | --- |
| Backend | `Set-Location D:\ProjectStudy\FrontierScan\backend; mvn package` |
| Frontend | `Set-Location D:\ProjectStudy\FrontierScan\frontend; npm run build` |
| Docker/env | `docker compose build` after approval |

## Rules

- Failed builds block interface verification and delivery.
- Do not deploy or publish from a build gate without explicit approval.
- Record exact command, result, and important output.
- Do not treat prior terminal output as current evidence.

## Helper

Run:

```powershell
.\.harness\scripts\plan-build.ps1
```

The helper is read-only and emits recommended build commands.
