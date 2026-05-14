# Jira Skill

Search, create, update, and transition Jira issues. Add comments, assign users, and query with JQL.

## Setup

Install dependencies:

```bash
npm install
```

### Credentials

File: `~/.config/jira-mcp/.env`

```env
JIRA_BASE_URL=https://your-org.atlassian.net
JIRA_EMAIL=your.email@example.com
JIRA_API_TOKEN=your_api_token_here
```

Create an API token at [Atlassian API tokens](https://id.atlassian.com/manage-profile/security/api-tokens).

---

## Usage

From this skill directory:

```bash
node ./scripts/jira-cli.mjs --tool <tool> --args '<json>'
```

| Tool               | Description                                           | Key args                             |
| ------------------ | ----------------------------------------------------- | ------------------------------------ |
| `search_issues`    | Search with JQL                                       | `jql`, `maxResults`                  |
| `get_issue`        | Get issue details                                     | `issueKey`                           |
| `create_issue`     | Create a new issue                                    | `projectKey`, `summary`, `issueType` |
| `update_issue`     | Update an issue                                       | `issueKey`                           |
| `transition_issue` | Change status (omit `transitionName` to list options) | `issueKey`, `transitionName`         |
| `delete_issue`     | Delete an issue                                       | `issueKey`, `deleteSubtasks`         |
| `add_comment`      | Add a comment                                         | `issueKey`, `body`                   |
| `get_comments`     | Get comments                                          | `issueKey`                           |
| `list_projects`    | List all projects                                     | _(none)_                             |
| `assign_issue`     | Assign to a user                                      | `issueKey`, `accountId`              |
| `search_users`     | Find user account ID                                  | `query`                              |

### Examples

```bash
node ./scripts/jira-cli.mjs --tool search_issues --args '{"jql":"project=PROJ AND sprint in openSprints()","maxResults":20}'
node ./scripts/jira-cli.mjs --tool get_issue --args '{"issueKey":"PROJ-1234"}'
node ./scripts/jira-cli.mjs --tool transition_issue --args '{"issueKey":"PROJ-1234","transitionName":"In Progress"}'
node ./scripts/jira-cli.mjs --tool add_comment --args '{"issueKey":"PROJ-1234","body":"Investigation started."}'
```

### JQL Tips

- `project=PROJ AND sprint in openSprints()` — current sprint
- `project=PROJ AND assignee=currentUser()` — my issues
- `project=PROJ AND status="In Progress"` — in-progress
- `project=PROJ AND created>=-7d` — created in last 7 days
- `project=PROJ AND text~"search term"` — text search
