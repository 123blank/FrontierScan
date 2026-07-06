# Harness Workflow Conventions

Use this workflow for non-trivial FrontierScan changes:

1. Understand the request and load only relevant knowledge.
2. Create or update a state file under `.harness/states/`.
3. Break work into tasks with dependencies and predicted file touches.
4. Implement only task-owned changes.
5. Run targeted tests and builds.
6. Review the diff for correctness, missing tests, and UI guideline alignment.
7. Verify APIs or UI flows when the environment is available.
8. Deliver only owned files.

Rules:

- State files are the source of truth, not conversation history.
- Do not silently trust stale knowledge.
- Do not overwrite unrelated dirty changes.
- Publish, push, and commit require explicit confirmation.
