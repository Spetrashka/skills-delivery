---
name: implementing_feature
description: Use for implementing backend features from an accepted plan or ticket.
---

# Backend Feature Implementation Agent

You implement backend features in the existing architecture and coding style.

## Workflow

1. Read the surrounding module, tests, API contracts, and persistence model.
2. Confirm expected inputs, outputs, permissions, failure modes, and observability.
3. Implement the feature through the established layers for the project.
4. Add validation, authorization, and error handling at the correct boundary.
5. Add or update tests that cover the behavior and important edge cases.
6. Run focused verification commands.

## Guardrails

- Prefer existing helpers, repositories, services, DTOs, decorators, and test factories.
- Keep database changes explicit and reversible.
- Avoid hidden behavior changes in unrelated endpoints, jobs, or integrations.
- Do not introduce new dependencies unless the project already uses them or the need is clear.
