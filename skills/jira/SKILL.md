---
name: jira
description: 'Interact with Jira issues and projects via CLI. Use when asked to: search issues with JQL, get issue details, create or update issues, transition issue status, add comments, assign issues, list projects, find users. Triggers: "Jira", "ticket", "issue", "sprint", "story", "JQL", "backlog", "transition", "QIN-", "PROJ-".'
---

# Jira Skill

## What This Does

Reads and manages Jira issues, comments, assignments, and transitions using the Jira REST API v3.

## CLI Location

All operations run from this skill directory through:

```bash
node ./scripts/jira-cli.mjs --tool <tool> --args '<json>'
```

## Procedure

### 1. Run the appropriate tool

| Goal                 | Tool               | Key args                                                                        |
| -------------------- | ------------------ | ------------------------------------------------------------------------------- |
| Search issues (JQL)  | `search_issues`    | `jql`, `maxResults`                                                             |
| Get a single issue   | `get_issue`        | `issueKey`                                                                      |
| Create an issue      | `create_issue`     | `projectKey`, `summary`, `issueType`, `description`, `priority`, `labels`       |
| Update an issue      | `update_issue`     | `issueKey`, `summary`, `description`, `assigneeAccountId`, `priority`, `labels` |
| Change issue status  | `transition_issue` | `issueKey`, `transitionName` (omit to list available)                           |
| Delete an issue      | `delete_issue`     | `issueKey`, `deleteSubtasks`                                                    |
| Add a comment        | `add_comment`      | `issueKey`, `body`                                                              |
| Get comments         | `get_comments`     | `issueKey`                                                                      |
| List projects        | `list_projects`    | _(no args)_                                                                     |
| Assign to user       | `assign_issue`     | `issueKey`, `accountId`                                                         |
| Find user account ID | `search_users`     | `query`                                                                         |

### 2. Example commands

```bash
# Find issues in current sprint
node ./scripts/jira-cli.mjs --tool search_issues --args '{"jql":"project=QIN AND sprint in openSprints()","maxResults":20}'

# Get a specific ticket
node ./scripts/jira-cli.mjs --tool get_issue --args '{"issueKey":"QIN-1234"}'

# Create a bug ticket
node ./scripts/jira-cli.mjs --tool create_issue --args '{"projectKey":"QIN","summary":"Fix login redirect","issueType":"Bug","description":"Users are redirected to 404 after login","priority":"High"}'

# Move ticket to In Progress (list transitions first if unsure)
node ./scripts/jira-cli.mjs --tool transition_issue --args '{"issueKey":"QIN-1234"}'
node ./scripts/jira-cli.mjs --tool transition_issue --args '{"issueKey":"QIN-1234","transitionName":"In Progress"}'

# Add a comment
node ./scripts/jira-cli.mjs --tool add_comment --args '{"issueKey":"QIN-1234","body":"Investigation started. Root cause identified in auth middleware."}'

# Find a user to assign
node ./scripts/jira-cli.mjs --tool search_users --args '{"query":"serj"}'

# Assign issue
node ./scripts/jira-cli.mjs --tool assign_issue --args '{"issueKey":"QIN-1234","accountId":"<accountId from search_users>"}'
```

### 3. JQL Tips

-   `project=QIN AND sprint in openSprints()` — current sprint
-   `project=QIN AND assignee=currentUser()` — my issues
-   `project=QIN AND status="In Progress"` — in-progress
-   `project=QIN AND created>=-7d` — created in last 7 days
-   `project=QIN AND text~"wizard"` — text search

## Auth

Reads `JIRA_BASE_URL`, `JIRA_EMAIL`, and `JIRA_API_TOKEN` from `~/.config/jira-mcp/.env`.
