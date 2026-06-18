# Cursor workspace configuration

## Contents

- [Git / deploy policy](#git--deploy-policy)
- [Related documentation](#related-documentation)

## Git / deploy policy

**Agents must never push directly to `main`.**

- `main` → staging autodeploy (see [`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml))
- All changes go through a **feature branch + pull request**
- PRs are reviewed with **CodeRabbit** before merge

Enforced in:

- [AGENTS.md](../AGENTS.md) (canonical)
- [`.cursor/rules/git-workflow.mdc`](rules/git-workflow.mdc) (`alwaysApply: true`)
- [CLAUDE.md](../CLAUDE.md) (summary)

## Related documentation

| Document | Description |
| --- | --- |
| [Repository README](../README.md) | Monorepo overview, local setup, full documentation map |
| [AGENTS.md](../AGENTS.md) | Architecture, auth, D1 schema, secrets, implementation roadmap |
