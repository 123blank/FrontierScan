---
name: frontier-interface-verifier
description: Use when verifying FrontierScan backend APIs or frontend-visible workflows from acceptance criteria after build or deployment, including request/action construction, assertions, diagnostics, and unavailable-environment reporting.
---

# Frontier Interface Verifier

Use this Skill after build/publish or local startup, when an environment is available or must be marked unavailable.

## Quick Workflow

1. Read `references/verification-case-schema.md`.
2. Draft cases from the task DAG:

```powershell
.\.harness\scripts\derive-interface-cases.ps1 -TaskDagFile <task-dag-file>
```

3. Read `references/environment-policy.md`.
4. Fill stable `caseId`, `required`, referenced `criterionIds`, concrete action, and expected observable result.
5. Execute only when the environment is available and safe.
6. Read `references/failure-diagnosis-policy.md` for failures.
7. Write `.harness/reports/interface-verification-report.md` using `.harness/templates/interface-verification-report.md`.

## Outputs

- `.harness/reports/interface-verification-report.md`
- Verification case records in E2E state files

## Safety Rules

- Do not modify code while verifying.
- Record unavailable environments instead of fabricating verification.
- Include request/action, expected result, actual result, and diagnosis for failures.
- Every required criterion must have a verification conclusion.
- `accepted-with-known-gaps` requires `run-story.ps1 approve-gap` and a current attempt-scoped approval receipt.
- Optional-only failed or blocked results remain visible but do not block required acceptance.
- Required failed or blocked results block delivery; environment unavailable does not automatically count as accepted.
