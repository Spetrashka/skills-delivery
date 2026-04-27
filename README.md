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

## Skills

| Skill | Description |
| ----- | ----------- |
| [browser-devtools](skills/browser-devtools/README.md) | Inspect computed CSS styles, capture console logs, get JS errors, evaluate expressions, and take screenshots via CDP |
| [github-pr](skills/github-pr/README.md) | Read and manage GitHub PRs, inline review comments, issue comments, and reviews via the GitHub REST API |
| [jira](skills/jira/README.md) | Search, create, update, and transition Jira issues. Add comments, assign users, and query with JQL |
