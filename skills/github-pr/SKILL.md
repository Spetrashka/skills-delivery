---
name: github-pr
description: 'Interact with GitHub Pull Requests and Issues via CLI. Use when asked to: read PR details, list or edit PR review comments, manage inline code review comments, add or delete issue comments, create reviews, audit PR comment threads, bulk-edit review feedback. Triggers: "PR", "pull request", "review comment", "GitHub comment", "code review".'
---

# GitHub PR Skill

## What This Does

Reads and manages GitHub PRs, code review comments, and issue comments using the GitHub REST API.

## CLI Location

All operations run through: `node ./scripts/github-pr-cli.mjs --tool <tool> --args '<json>'`

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
| Edit a review comment       | `edit_pr_comment`      | `owner`, `repo`, `commentId`, `body`                                           |
| Delete a review comment     | `delete_pr_comment`    | `owner`, `repo`, `commentId`                                                   |
| List PR reviews             | `list_pr_reviews`      | `owner`, `repo`, `pr`                                                          |
| Edit a review body          | `edit_pr_review`       | `owner`, `repo`, `pr`, `reviewId`, `body`                                      |
| List issue comments         | `list_issue_comments`  | `owner`, `repo`, `issue`                                                       |
| Add an issue comment        | `add_issue_comment`    | `owner`, `repo`, `issue`, `body`                                               |
| Edit an issue comment       | `edit_issue_comment`   | `owner`, `repo`, `commentId`, `body`                                           |
| Delete an issue comment     | `delete_issue_comment` | `owner`, `repo`, `commentId`                                                   |
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

# Add an issue comment
node ./scripts/github-pr-cli.mjs --tool add_issue_comment --args '{"owner":"quext","repo":"quext-spa","issue":99,"body":"Looking into this."}'

# Submit an approving review
node ./scripts/github-pr-cli.mjs --tool create_review --args '{"owner":"quext","repo":"quext-spa","pr":42,"event":"APPROVE","body":"LGTM"}'
```

## Auth

Reads `GITHUB_TOKEN` from `~/.config/github-mcp/.env`. No setup needed if the file exists.
