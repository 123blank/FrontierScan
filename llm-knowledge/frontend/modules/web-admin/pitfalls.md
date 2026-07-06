# Frontend Pitfalls

Record frontend implementation risks here.

Initial known risks:

- Do not introduce new UI patterns when existing local components and CSS can handle the workflow.
- Keep B2B admin pages table-driven and operation-oriented.
- Create/new actions should use top-right primary buttons and dialogs when UI guidelines require it.
- Run `npm run build` from `frontend` after frontend changes.
- Avoid changing dirty user-owned frontend files unless the task requires it.

Future generated sections should include:

- File or component location
- Pitfall description
- Avoidance guidance
- Relevant verification command
