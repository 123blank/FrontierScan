# Review And Test Gates

Required gates:

1. Review changed files only, unless broader context is necessary.
2. Identify BLOCKER findings before build/publish/delivery.
3. Select tests by touched area.
4. Record commands and results in `.harness/reports/` or `.harness/states/`.
5. Call out unrelated dirty files.

Default commands:

```powershell
Set-Location D:\ProjectStudy\FrontierScan\backend
mvn test
```

```powershell
Set-Location D:\ProjectStudy\FrontierScan\frontend
npm run build
```
