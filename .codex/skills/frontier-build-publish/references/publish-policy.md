# Publish Policy

Publishing is external-state-changing work and requires explicit user approval.

## Before Approval

- Produce a build plan.
- Confirm tests, review, and required builds passed.
- Identify target environment.
- Identify rollback or cleanup notes.
- State what command would be run.

## Without Approval

- Do not run deployment commands.
- Do not modify production or test infrastructure.
- Do not push images or artifacts.
- Do not change environment variables or secrets.

## Allowed Without Approval

- Read configs.
- Produce a dry-run style plan.
- Run local non-deploying builds when appropriate.
