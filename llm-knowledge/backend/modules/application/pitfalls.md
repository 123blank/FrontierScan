# Backend Pitfalls

Record backend implementation risks here.

Initial known risks:

- Do not rely on stale generated knowledge when API or migration files changed.
- Keep database migration changes explicit and reviewed.
- Treat collection/parsing network behavior as failure-prone.
- Keep authentication and authorization behavior covered by tests.

Future generated sections should include:

- File or package location
- Pitfall description
- Avoidance guidance
- Relevant tests
