# Frontier State Update Rules

Use these rules before creating or editing active Harness state files.

## Creation

1. Copy the closest template from `.harness/states/`.
2. Save the active file under `.harness/states/` with a task-specific name.
3. Fill identifiers before doing phase work:
   - Product state: `requestId`, `sourceRequest`
   - E2E state: `storyId`, `requirement.summary`
4. Run:

```powershell
.\.harness\scripts\validate-state.ps1 -StateFile <state-file>
```

## Update Discipline

- Update only the fields owned by the current phase.
- Append evidence to `logs`; do not erase prior decisions.
- Record paths to generated outputs in the relevant phase fields when possible.
- Keep templates unchanged.
- If a required external environment is unavailable, record that fact instead of pretending verification passed.

## Phase Advancement

Before advancing `phase`:

1. Validate the current state file.
2. Confirm required output artifacts for the current phase exist.
3. Confirm relevant quality gates passed or were explicitly skipped with a reason.
4. Record the phase transition in `logs`.
5. Set the next phase.
6. Validate the state file again.

## Blocking

Set `phase` to `blocked` when the workflow cannot continue without a user decision or external dependency.

Every blocked state must record:

- Blocking reason
- Owner or next decision-maker
- Last completed phase
- Suggested next action

Do not use `blocked` for ordinary failing tests or review findings when the next fix is clear.
