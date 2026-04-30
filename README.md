# skills-delivery

Reusable Claude Code skills for browser debugging, GitHub PR management, and Jira integration.

## Installation

```bash
# Install all skills
npx skills add Spetrashka/skills-delivery --skill '*'

# Install specific skills
npx skills add Spetrashka/skills-delivery --skill jira
npx skills add Spetrashka/skills-delivery --skill github-pr
npx skills add Spetrashka/skills-delivery --skill browser-devtools

# Mix and match
npx skills add Spetrashka/skills-delivery --skill jira --skill github-pr

# List available skills
npx skills add Spetrashka/skills-delivery --list
```

## Setup

Some skills have npm dependencies. After installing, run the setup script to install them all at once:

```bash
npx skills-delivery-setup
```

## Backend AI Instructions Generator

Generate a backend `.github` AI instruction set from the target project's file system, package scripts, detected frameworks, and module structure:

```bash
npx create-backend-copilot-instructions
```

This creates:

- `.github/copilot-instructions.md`
- `.github/instructions/*.instructions.md` for detected frameworks, such as NestJS
- `.github/agents/*.agent.md` only when explicitly requested with `--agents`

Existing files are skipped by default. Use `--dry-run` to preview changes and `--force` to overwrite existing files. Use `--requirement` to include user-specific requirements in the root Copilot instructions.

## Skills

| Skill | Description |
| ----- | ----------- |
| [generate-backend-copilot-instructions](skills/generate-backend-copilot-instructions/SKILL.md) | Generate repository-specific GitHub Copilot backend instruction files under `.github` |
| [browser-devtools](skills/browser-devtools/README.md) | Inspect computed CSS styles, capture console logs, get JS errors, evaluate expressions, and take screenshots via CDP |
| [github-pr](skills/github-pr/README.md) | Read and manage GitHub PRs, inline review comments, issue comments, and reviews via the GitHub REST API |
| [jira](skills/jira/README.md) | Search, create, update, and transition Jira issues. Add comments, assign users, and query with JQL |
