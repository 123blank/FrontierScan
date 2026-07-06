---
name: frontier-state-runner
description: Maintain, validate, resume, and advance FrontierScan Harness state files. Use when Codex needs to work with product-state.json or e2e-state.json across requirement, technical design, task DAG, implementation, test, review, build, interface verification, and delivery phases.
---

# Frontier State Runner

Use this Skill whenever workflow progress must survive beyond a single conversation.

## Quick Workflow

1. Identify whether the task is product-level or single-story.
2. Create an active state file from the relevant template if none exists.
3. Validate the state file before reading or updating it:

```powershell
.\.harness\scripts\validate-state.ps1 -StateFile <state-file>
```

4. Read the current `phase` and required outputs for that phase.
5. Perform only the work allowed for the current phase.
6. Record outputs, decisions, skipped gates, and evidence in the state file.
7. Validate again before moving to the next phase.

## State Files

- `.harness/states/e2e-state.template.json`
- `.harness/states/product-state.template.json`

Active state files should use task-specific names, for example:

- `.harness/states/e2e-S1.json`
- `.harness/states/product-YYYYMMDD-HHMM-short-name.json`

Do not edit templates as active state.

## References

- Read `references/phase-model.md` when deciding the current or next phase.
- Read `references/state-update-rules.md` before creating or editing active state files.

## Rules

- Treat state files as the source of truth, not conversation history.
- Validate state before and after updates.
- Record skipped tests and unavailable environments.
- Do not advance past a failed quality gate.
- Do not mark publish, commit, push, or PR phases complete without explicit user approval and evidence.
