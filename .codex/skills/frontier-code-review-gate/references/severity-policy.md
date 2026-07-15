# Severity Policy

Use the highest severity that matches the realistic impact.

## Review Threshold

Review for the project's current maturity level: preserve basic usability and reasonable extensibility without attempting exhaustive hardening.

Only report a finding when it has concrete evidence and a realistic path to affecting the main workflow, correctness, security, data integrity, or near-term extension work. Do not report low-probability hypotheticals, speculative future requirements, minor style preferences, or defensive handling for scenarios outside the current stage. Prefer a short list of actionable findings over a complete inventory of possible improvements.

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

- A concrete residual risk that materially affects a current engineering or delivery decision.
- Residual risk already mitigated by tests or narrow scope.

Do not use NOTE as a bucket for optional cleanup, style preferences, speculative edge cases, or future hardening ideas.

## Reporting

- Lead with findings, ordered by severity.
- Include file and line whenever possible.
- Explain impact in concrete user or operational terms.
- If there are no findings, say so and still list test gaps or unverified areas.
- Omit concerns that do not meet the review threshold instead of listing them as non-blocking findings.
