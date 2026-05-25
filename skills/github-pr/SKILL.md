---
name: github-pr
description: 'Interact with GitHub Pull Requests and Issues via CLI. Use when asked to: read or update PR details, change PR draft status, manage reviewers, labels, assignees, inline review comments, issue comments, reviews, or audit PR comment threads. Triggers: "PR", "pull request", "review comment", "GitHub comment", "code review".'
---

# GitHub PR Skill

## What This Does

Reads and manages GitHub PRs, reviewers, labels, assignees, code review comments, and issue comments using the GitHub REST and GraphQL APIs.

## CLI Location

All operations run from this skill directory through:

```bash
node ./scripts/github-pr-cli.mjs --tool <tool> --args '<json>'
```

## Required Args for Every Call

Every tool requires `owner` (GitHub org/user), `repo` (repository name), and where applicable `pr` (PR number) or `commentId`.

## Procedure

### 1. Identify the repository

Determine `owner` and `repo` from context (e.g. from the workspace remote URL via `git remote get-url origin`).

### 2. Run the appropriate tool

| Goal                        | Tool                   | Key args                                                                       |
| --------------------------- | ---------------------- | ------------------------------------------------------------------------------ |
| **List all PRs**            | `list_prs`             | `owner`, `repo`, `state` (`open`/`closed`/`all`), `perPage`                    |
| Get PR details              | `get_pr`               | `owner`, `repo`, `pr`                                                          |
| List inline review comments | `list_pr_comments`     | `owner`, `repo`, `pr`                                                          |
| Get a single review comment | `get_pr_comment`       | `owner`, `repo`, `commentId`                                                   |
| Reply to a review comment   | `reply_pr_comment`     | `owner`, `repo`, `pr`, `commentId`, `body`                                     |
| Edit a review comment       | `edit_pr_comment`      | `owner`, `repo`, `commentId`, `body`                                           |
| Delete a review comment     | `delete_pr_comment`    | `owner`, `repo`, `commentId`                                                   |
| List PR reviews             | `list_pr_reviews`      | `owner`, `repo`, `pr`                                                          |
| Edit a review body          | `edit_pr_review`       | `owner`, `repo`, `pr`, `reviewId`, `body`                                      |
| List issue comments         | `list_issue_comments`  | `owner`, `repo`, `issue`                                                       |
| Add an issue comment        | `add_issue_comment`    | `owner`, `repo`, `issue`, `body`                                               |
| Edit an issue comment       | `edit_issue_comment`   | `owner`, `repo`, `commentId`, `body`                                           |
| Delete an issue comment     | `delete_issue_comment` | `owner`, `repo`, `commentId`                                                   |
| Create a pull request       | `create_pr`            | `owner`, `repo`, `title`, `head`, `base`, `body`, `draft`                      |
| Update a pull request       | `update_pr`            | `owner`, `repo`, `pr`, `title`, `body`, `base`, `draft`                        |
| Mark draft PR ready         | `convert_pr_to_ready`  | `owner`, `repo`, `pr`                                                          |
| Request reviewers           | `request_reviewers`    | `owner`, `repo`, `pr`, `reviewers`, `team_reviewers`                           |
| Add labels                  | `add_labels`           | `owner`, `repo`, `pr`, `labels`                                                |
| Remove labels               | `remove_labels`        | `owner`, `repo`, `pr`, `labels`, `all`                                         |
| Assign users                | `assign`               | `owner`, `repo`, `pr`, `assignees`                                             |
| Submit a review             | `create_review`        | `owner`, `repo`, `pr`, `event` (`APPROVE`/`REQUEST_CHANGES`/`COMMENT`), `body` |
| Full PR audit               | `audit_pr_comments`    | `owner`, `repo`, `pr`                                                          |

### 3. Example commands

```bash
# Get PR details
node ./scripts/github-pr-cli.mjs --tool get_pr --args '{"owner":"quext","repo":"quext-spa","pr":42}'

# List all inline review comments
node ./scripts/github-pr-cli.mjs --tool list_pr_comments --args '{"owner":"quext","repo":"quext-spa","pr":42}'

# Edit a review comment
node ./scripts/github-pr-cli.mjs --tool edit_pr_comment --args '{"owner":"quext","repo":"quext-spa","commentId":123456,"body":"Updated feedback"}'

# Reply to an inline review comment
node ./scripts/github-pr-cli.mjs --tool reply_pr_comment --args '{"owner":"quext","repo":"quext-spa","pr":42,"commentId":123456,"body":"Thanks, fixed in the latest push."}'

# Add an issue comment
node ./scripts/github-pr-cli.mjs --tool add_issue_comment --args '{"owner":"quext","repo":"quext-spa","issue":99,"body":"Looking into this."}'

# Create a PR
node ./scripts/github-pr-cli.mjs --tool create_pr --args '{"owner":"quext","repo":"quext-spa","title":"Fix login redirect","head":"feature/login-redirect","base":"main","body":"Summary of changes","draft":true}'

# Update PR metadata
node ./scripts/github-pr-cli.mjs --tool update_pr --args '{"owner":"quext","repo":"quext-spa","pr":42,"title":"Fix login redirect","base":"develop","draft":false}'

# Mark a draft PR ready for review
node ./scripts/github-pr-cli.mjs --tool convert_pr_to_ready --args '{"owner":"quext","repo":"quext-spa","pr":42}'

# Request individual and team reviewers
node ./scripts/github-pr-cli.mjs --tool request_reviewers --args '{"owner":"quext","repo":"quext-spa","pr":42,"reviewers":["octocat"],"team_reviewers":["frontend"]}'

# Add or remove labels
node ./scripts/github-pr-cli.mjs --tool add_labels --args '{"owner":"quext","repo":"quext-spa","pr":42,"labels":["bug","ready for review"]}'
node ./scripts/github-pr-cli.mjs --tool remove_labels --args '{"owner":"quext","repo":"quext-spa","pr":42,"labels":["bug"]}'

# Assign users
node ./scripts/github-pr-cli.mjs --tool assign --args '{"owner":"quext","repo":"quext-spa","pr":42,"assignees":["octocat"]}'

# Submit an approving review
node ./scripts/github-pr-cli.mjs --tool create_review --args '{"owner":"quext","repo":"quext-spa","pr":42,"event":"APPROVE","body":"LGTM"}'
```

## Auth

Reads `GITHUB_TOKEN` from `~/.config/github-mcp/.env`. No setup needed if the file exists.
