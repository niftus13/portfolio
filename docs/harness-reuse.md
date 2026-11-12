# Reusing the project harness

The repository is a project-specific example, not an automatically shared instruction source. To use its harness in a new repository, copy the files into that repository or create a separate template repository from a reviewed version. Git template copies do not automatically receive later changes.

## What to copy

- Copy `.github/copilot-instructions.md`, `.github/instructions/`, `.github/agents/`, and `.github/skills/` to the same locations for VS Code Copilot to discover them.
- Copy `specs/`, `docs/`, `tests/`, `evals/`, and `scripts/` guidance as needed. Carry over runnable configuration and dependency manifests along with any verification commands you intend to use.
- If the target uses this repository's stack, use `apps/api/`, `apps/webs/`, `packages/shared/`, and the Compose configuration as a starting point. Do not copy `.env`, generated output, `node_modules/`, or existing database volumes.

## Adapt before use

1. Review the project-wide instructions and decision record. Replace project-specific paths, technology choices, and commands where the new project differs.
2. Update each `applyTo` pattern to match the new source and test paths. An instruction with an incorrect pattern will not reliably attach to the intended files.
3. Keep only applicable agents and skills. In particular, authentication and tenant isolation checks are required when relevant, not proof that every project has a tenant model.
4. Ensure the referenced test, eval, lint, and type-check commands actually exist and run against the intended files. Add project-specific acceptance criteria and tests rather than treating copied examples as coverage.
5. Review the sample Compose credentials and ports, create project-local secrets, and validate the images and live database connection in the target environment.

`copilot-instructions.md` provides project-wide guidance; file instructions attach based on their patterns; agents and skills are selected or loaded for suitable tasks. These instructions guide an agent but do not enforce policy or automatically run tests. Use the project's verification commands and CI for deterministic checks.

For ongoing reuse, maintain and version the reviewed template separately, then compare and selectively apply updates to each project. Preserve project-specific changes rather than overwriting them.
