# Failure Diagnosis Policy

Diagnose failures with evidence, not guesses.

## Required Evidence

- Request/action attempted.
- Expected result.
- Actual status code, response body summary, UI state, or error message.
- Environment and service status.
- Related logs if available.

## Diagnosis Levels

- Contract mismatch: frontend/API expectation differs from backend behavior.
- Data/setup issue: required seed data, auth, or dependency is missing.
- Runtime failure: service crashed, build unavailable, network error.
- Requirement ambiguity: acceptance criterion is not executable as written.

## Rule

A failed verification case blocks delivery unless fixed, explicitly accepted, or reclassified as out of scope by the user.
