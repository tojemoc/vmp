# Cursor workspace configuration

## Git / deploy policy

**Agents must never push directly to `main`.**

- `main` → staging autodeploy (see `.github/workflows/deploy.yml`)
- All changes go through a **feature branch + pull request**
- PRs are reviewed with **CodeRabbit** before merge

Enforced in:

- `AGENTS.md` (canonical)
- `.cursor/rules/git-workflow.mdc` (`alwaysApply: true`)
- `CLAUDE.md` (summary)
