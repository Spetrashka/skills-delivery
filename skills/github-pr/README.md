# GitHub PR Skill

Read and manage GitHub PRs, reviewers, labels, assignees, inline review comments, issue comments, and reviews via the GitHub REST and GraphQL APIs.

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

From this skill directory:

```bash
node ./scripts/github-pr-cli.mjs --tool <tool> --args '<json>'
```

| Tool                   | Description                           | Key args                                                    |
| ---------------------- | ------------------------------------- | ----------------------------------------------------------- |
| `list_prs`             | List all PRs                          | `owner`, `repo`, `state` (`open`/`closed`/`all`), `perPage` |
| `get_pr`               | Get PR details                        | `owner`, `repo`, `pr`                                       |
| `list_pr_comments`     | List inline review comments           | `owner`, `repo`, `pr`                                       |
| `get_pr_comment`       | Get a single review comment           | `owner`, `repo`, `commentId`                                |
| `reply_pr_comment`     | Reply to an inline review comment     | `owner`, `repo`, `pr`, `commentId`, `body`                  |
| `edit_pr_comment`      | Edit a review comment                 | `owner`, `repo`, `commentId`, `body`                        |
| `delete_pr_comment`    | Delete a review comment               | `owner`, `repo`, `commentId`                                |
| `list_pr_reviews`      | List PR reviews                       | `owner`, `repo`, `pr`                                       |
| `edit_pr_review`       | Edit a review body                    | `owner`, `repo`, `pr`, `reviewId`, `body`                   |
| `list_issue_comments`  | List issue comments                   | `owner`, `repo`, `issue`                                    |
| `add_issue_comment`    | Add an issue comment                  | `owner`, `repo`, `issue`, `body`                            |
| `edit_issue_comment`   | Edit an issue comment                 | `owner`, `repo`, `commentId`, `body`                        |
| `delete_issue_comment` | Delete an issue comment               | `owner`, `repo`, `commentId`                                |
| `create_pr`            | Create a pull request                 | `owner`, `repo`, `title`, `head`, `base`, `body`, `draft`   |
| `update_pr`            | Update PR metadata                    | `owner`, `repo`, `pr`, `title`, `body`, `base`, `draft`     |
| `convert_pr_to_ready`  | Mark draft PR ready for review        | `owner`, `repo`, `pr`                                       |
| `request_reviewers`    | Request user or team reviewers        | `owner`, `repo`, `pr`, `reviewers`, `team_reviewers`        |
| `add_labels`           | Add labels to a PR                    | `owner`, `repo`, `pr`, `labels`                             |
| `remove_labels`        | Remove labels from a PR               | `owner`, `repo`, `pr`, `labels`, `all`                      |
| `assign`               | Assign users to a PR                  | `owner`, `repo`, `pr`, `assignees`                          |
| `create_review`        | Submit a review                       | `owner`, `repo`, `pr`, `event`, `body`                      |
| `audit_pr_comments`    | Full audit of PR comments and reviews | `owner`, `repo`, `pr`                                       |

### Examples

```bash
node ./scripts/github-pr-cli.mjs --tool get_pr --args '{"owner":"org","repo":"repo","pr":42}'
node ./scripts/github-pr-cli.mjs --tool list_pr_comments --args '{"owner":"org","repo":"repo","pr":42}'
node ./scripts/github-pr-cli.mjs --tool reply_pr_comment --args '{"owner":"org","repo":"repo","pr":42,"commentId":123456,"body":"Thanks, fixed in the latest push."}'
node ./scripts/github-pr-cli.mjs --tool create_pr --args '{"owner":"org","repo":"repo","title":"Fix login redirect","head":"feature/login-redirect","base":"main","body":"Summary of changes","draft":true}'
node ./scripts/github-pr-cli.mjs --tool update_pr --args '{"owner":"org","repo":"repo","pr":42,"title":"Fix login redirect","body":"Updated summary","base":"develop","draft":false}'
node ./scripts/github-pr-cli.mjs --tool convert_pr_to_ready --args '{"owner":"org","repo":"repo","pr":42}'
node ./scripts/github-pr-cli.mjs --tool request_reviewers --args '{"owner":"org","repo":"repo","pr":42,"reviewers":["octocat"],"team_reviewers":["frontend"]}'
node ./scripts/github-pr-cli.mjs --tool add_labels --args '{"owner":"org","repo":"repo","pr":42,"labels":["ready for review"]}'
node ./scripts/github-pr-cli.mjs --tool remove_labels --args '{"owner":"org","repo":"repo","pr":42,"labels":["ready for review"]}'
node ./scripts/github-pr-cli.mjs --tool assign --args '{"owner":"org","repo":"repo","pr":42,"assignees":["octocat"]}'
node ./scripts/github-pr-cli.mjs --tool create_review --args '{"owner":"org","repo":"repo","pr":42,"event":"APPROVE","body":"LGTM"}'
```
