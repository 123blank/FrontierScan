# Harness Runtime

Runtime directories:

- `.harness/schemas/`: JSON schemas for product state, E2E state, and task DAGs.
- `.harness/states/`: active state files and templates.
- `.harness/workflows/`: workflow phase definitions.
- `.harness/templates/`: output report templates.
- `.harness/reports/`: validation reports.
- `.harness/outputs/`: generated planning and phase outputs.

State rules:

- Use `product-state.template.json` for multi-story product requests.
- Use `e2e-state.template.json` for a single story.
- Do not use conversation history as the only record of workflow progress.
- Record skipped tests and unavailable verification environments.
