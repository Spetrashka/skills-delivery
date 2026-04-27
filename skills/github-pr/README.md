# GitHub PR Skill

Read and manage GitHub PRs, inline review comments, issue comments, and reviews via the GitHub REST API.

## Setup

Install dependencies:

```bash
npm install
```

### Credentials

File: `~/.config/github-mcp/.env`

```env
GITHUB_TOKEN=ghp_your_token_here
```

Create a token at [GitHub Settings > Developer settings > Personal access tokens](https://github.com/settings/tokens) with `repo` scope.

> The script also accepts `GITHUB_PACKAGES_TOKEN` — if you already have a GitHub packages token configured, no additional setup is needed.

---

## Usage

```bash
node ./scripts/github-pr-cli.mjs --tool <tool> --args '<json>'
```

| Tool                   | Description                           | Key args                                                    |
| ---------------------- | ------------------------------------- | ----------------------------------------------------------- |
| `list_prs`             | List all PRs                          | `owner`, `repo`, `state` (`open`/`closed`/`all`), `perPage` |
| `get_pr`               | Get PR details                        | `owner`, `repo`, `pr`                                       |
| `list_pr_comments`     | List inline review comments           | `owner`, `repo`, `pr`                                       |
| `get_pr_comment`       | Get a single review comment           | `owner`, `repo`, `commentId`                                |
| `edit_pr_comment`      | Edit a review comment                 | `owner`, `repo`, `commentId`, `body`                        |
| `delete_pr_comment`    | Delete a review comment               | `owner`, `repo`, `commentId`                                |
| `list_pr_reviews`      | List PR reviews                       | `owner`, `repo`, `pr`                                       |
| `edit_pr_review`       | Edit a review body                    | `owner`, `repo`, `pr`, `reviewId`, `body`                   |
| `list_issue_comments`  | List issue comments                   | `owner`, `repo`, `issue`                                    |
| `add_issue_comment`    | Add an issue comment                  | `owner`, `repo`, `issue`, `body`                            |
| `edit_issue_comment`   | Edit an issue comment                 | `owner`, `repo`, `commentId`, `body`                        |
| `delete_issue_comment` | Delete an issue comment               | `owner`, `repo`, `commentId`                                |
| `create_review`        | Submit a review                       | `owner`, `repo`, `pr`, `event`, `body`                      |
| `audit_pr_comments`    | Full audit of PR comments and reviews | `owner`, `repo`, `pr`                                       |

### Examples

```bash
node ./scripts/github-pr-cli.mjs --tool get_pr --args '{"owner":"org","repo":"repo","pr":42}'
node ./scripts/github-pr-cli.mjs --tool list_pr_comments --args '{"owner":"org","repo":"repo","pr":42}'
node ./scripts/github-pr-cli.mjs --tool create_review --args '{"owner":"org","repo":"repo","pr":42,"event":"APPROVE","body":"LGTM"}'
```
