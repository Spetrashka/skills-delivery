# skills-delivery

Reusable skills for Jira, GitHub PR workflows, browser debugging, and backlog triage with AI models (including GitHub Copilot models).

## Installation

```bash
# Install all skills
npx skills add Spetrashka/skills-delivery --skill '*'

# Install specific skills
npx skills add Spetrashka/skills-delivery --skill jira
npx skills add Spetrashka/skills-delivery --skill github-pr
npx skills add Spetrashka/skills-delivery --skill browser-devtools
npx skills add Spetrashka/skills-delivery --skill task-sorter

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

## Detailed installation docs

For deeper setup instructions (auth, env vars, provider-specific config), use per-skill docs:

- [Jira skill setup](skills/jira/README.md)
- [GitHub PR skill setup](skills/github-pr/README.md)
- [Browser DevTools skill setup](skills/browser-devtools/README.md)
- [Task Sorter setup (Bun + Copilot models)](skills/task-sorter/README.md)

Quick links:
- Install skills: [Installation](#installation)
- Install dependencies after adding skills: [Setup](#setup)

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
| [browser-devtools](skills/browser-devtools/README.md) | Launch a debug Chrome/Chromium browser, inspect computed CSS styles, capture console logs, get JS errors, evaluate expressions, and take screenshots via CDP |
| [github-pr](skills/github-pr/README.md) | Read and manage GitHub PRs, inline review comments, issue comments, and reviews via the GitHub REST API |
| [jira](skills/jira/README.md) | Search, create, update, and transition Jira issues. Add comments, assign users, and query with JQL |
| [task-sorter](skills/task-sorter/README.md) | Export Jira backlog to JSON, analyze and prioritize issues with AI, detect possible duplicates, generate JSON/MD/HTML reports |
