# Severity Policy

Use the highest severity that matches the realistic impact.

## BLOCKER

Must be fixed before build, publish, interface verification, merge, or delivery.

- Correctness bug that breaks the requested behavior.
- Security issue, secret exposure, privilege bypass, or unsafe command execution.
- Data loss, data corruption, or uncontrolled destructive operation.
- Backend/frontend contract mismatch that breaks a user workflow.
- Required test/build/structure gate failed or was not run without accepted reason.
- Harness schema, DAG, or state violation that can misroute later agents.

## WARNING

Should be fixed before delivery or explicitly accepted by the user.

- Edge case likely to affect real users but not the main path.
- Missing validation, weak error message, or partial empty-state handling.
- Duplicated logic that creates near-term maintenance risk.
- Missing targeted test for changed behavior where broader verification passed.
- UI consistency issue that does not block the workflow.

## NOTE

Informational, non-blocking.

- Minor readability issue.
- Follow-up improvement outside the task scope.
- Residual risk already mitigated by tests or narrow scope.

## Reporting

- Lead with findings, ordered by severity.
- Include file and line whenever possible.
- Explain impact in concrete user or operational terms.
- If there are no findings, say so and still list test gaps or unverified areas.
