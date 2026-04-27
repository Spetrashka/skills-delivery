# skills-delivery

Reusable Claude Code skills for browser debugging, GitHub PR management, and Jira integration.

## Installation

### Install all skills

```bash
npx skills add Spetrashka/skills-delivery --skill '*'
```

### Install specific skills

```bash
# Only Jira
npx skills add Spetrashka/skills-delivery --skill jira

# Only GitHub PR
npx skills add Spetrashka/skills-delivery --skill github-pr

# Only browser devtools
npx skills add Spetrashka/skills-delivery --skill browser-devtools

# Mix and match
npx skills add Spetrashka/skills-delivery --skill jira --skill github-pr
```

### List available skills

```bash
npx skills add Spetrashka/skills-delivery --list
```

Skills are installed into your project's `.agents/skills/` directory.

## Post-install Setup

Skills that have npm dependencies (`github-pr`, `jira`) need a one-time install after being added.

```bash
# Auto-install deps for all added skills
npx skills-delivery-setup
```

Or install per-skill manually:

```bash
cd .agents/skills/github-pr && npm install
cd .agents/skills/jira && npm install
```

`browser-devtools` has zero npm dependencies (uses only Node.js built-ins) — no setup needed.

## Included Skills

### browser-devtools

Connect to Chrome/Chromium via CDP to inspect computed styles, capture console logs, get JS errors, evaluate expressions, and take screenshots.

**Requirements:** Chrome or Chromium with `--remote-debugging-port=9222`, Node.js 22+.

```bash
# Start Chrome with remote debugging
google-chrome --remote-debugging-port=9222 --user-data-dir=$HOME/.chrome-debug-profile http://localhost:8080 &

# Example: get computed styles
node ./scripts/browser-devtools.mjs styles-raw ".my-button" 0
```

### github-pr

Read and manage GitHub PRs, inline review comments, issue comments, and reviews via the GitHub REST API.

**Requirements:** GitHub personal access token.

```bash
node ./scripts/github-pr-cli.mjs --tool get_pr --args '{"owner":"org","repo":"repo","pr":42}'
```

### jira

Search, create, update, and transition Jira issues. Add comments, assign users, and query with JQL.

**Requirements:** Jira API token, base URL, and email.

```bash
node ./scripts/jira-cli.mjs --tool search_issues --args '{"jql":"project=PROJ AND sprint in openSprints()"}'
```

## Environment Variables

Each skill reads credentials from dedicated config files in `~/.config/`. These files are never committed to the repository.

### GitHub (`github-pr`)

File: `~/.config/github-mcp/.env`

```env
GITHUB_TOKEN=ghp_your_token_here
```

Create a token at [GitHub Settings > Developer settings > Personal access tokens](https://github.com/settings/tokens) with `repo` scope.

### Jira (`jira`)

File: `~/.config/jira-mcp/.env`

```env
JIRA_BASE_URL=https://your-org.atlassian.net
JIRA_EMAIL=your.email@example.com
JIRA_API_TOKEN=your_api_token_here
```

Create an API token at [Atlassian API tokens](https://id.atlassian.com/manage-profile/security/api-tokens).

### Browser DevTools (`browser-devtools`)

Optional environment variables (defaults work for local development):

| Variable   | Default     | Description              |
| ---------- | ----------- | ------------------------ |
| `CDP_HOST` | `localhost` | Browser host             |
| `CDP_PORT` | `9222`      | Browser remote debug port |
