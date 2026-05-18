---
name: task-sorter
description: Export the QIN Jira backlog without modifying Jira, save issues with descriptions to JSON, then analyze and sort tasks by importance using a structured LangChain model with OpenAI, Google Gemini, or Ollama. Use when asked to review, deduplicate, prioritize, rank, or sort the QIN backlog, Jira backlog, or task list into an output file only.
---

# QIN Task Sorter

## Purpose

Use this skill to produce an offline backlog analysis for QIN Jira issues:

1. Export all matching Jira issues, including descriptions and metadata, to JSON.
2. Analyze the exported file with a structured LangChain model.
3. Save sorted result files with priority ranking, duplicate groups, rationale, and risks.

Do not change Jira. This skill is read-only: no issue updates, comments, transitions, assignments, or field edits.

## Tool

Run from this skill directory:

```bash
bun ./scripts/task-sorter.ts run
```

From the repository root:

```bash
bun ./skills/task-sorter/scripts/task-sorter.ts run
```

## Auth

Reads Jira credentials from `~/.config/jira-mcp/.env`:

- `JIRA_BASE_URL`
- `JIRA_EMAIL`
- `JIRA_API_TOKEN`

The script also reads local settings from `skills/task-sorter/.env`.

Model credentials:

- OpenAI: `OPENAI_API_KEY`
- Google Gemini: `GOOGLE_GEMINI_API_KEY` or `GOOGLE_API_KEY`
- Ollama: `OLLAMA_BASE_URL` optional, defaults to `http://localhost:11434`
- Ollama thinking: disabled by default for structured output; set `OLLAMA_THINK=true` or pass `--think true` only when you want model reasoning included
- Copilot: `GITHUB_TOKEN` or `GITHUB_PACKAGES_TOKEN` (uses `https://api.githubcopilot.com`)

## Commands

| Command | Description |
| --- | --- |
| `export` | Export Jira issues only |
| `analyze` | Analyze an existing exported JSON file |
| `render` | Regenerate Markdown and HTML reports from an existing analysis JSON without calling a model |
| `run` | Export and analyze in one pass |

## Common Usage

```bash
# Export and analyze the QIN non-done backlog with Ollama by default
bun ./scripts/task-sorter.ts run

# Use any model from model.ts
bun ./scripts/task-sorter.ts run --model gpt-oss:20b

# Use OpenAI or Gemini models from model.ts
bun ./scripts/task-sorter.ts run --model gpt-5-mini
bun ./scripts/task-sorter.ts run --model gemini-2.5-pro

# Use Copilot models (requires GITHUB_TOKEN or GITHUB_PACKAGES_TOKEN)
bun ./scripts/task-sorter.ts run --model copilot:gpt-4.1
bun ./scripts/task-sorter.ts run --model copilot:claude-sonnet-4.6
bun ./scripts/task-sorter.ts run --model copilot:o4-mini

# Export only
bun ./scripts/task-sorter.ts export --out ./out/qin-backlog.json

# Analyze a saved export only
bun ./scripts/task-sorter.ts analyze --input ./out/qin-backlog.json --out ./out/qin-backlog.analysis.json

# Regenerate reports from existing analysis JSON
bun ./scripts/task-sorter.ts render --input ./out/qin-backlog.analysis.json --report ./out/qin-backlog.report.md --html ./out/qin-backlog.report.html

# Override JQL
bun ./scripts/task-sorter.ts run --jql 'project=QIN AND statusCategory != Done ORDER BY Rank ASC'
```

## Options

| Option | Default | Description |
| --- | --- | --- |
| `--jql` | `project=QIN AND statusCategory != Done ORDER BY Rank ASC` | Jira issue search query |
| `--out` | command-specific file under `./out` | Output path |
| `--input` | latest export path for `analyze` | Export file to analyze |
| `--report` | `.md` beside analysis JSON | Markdown report path |
| `--html` / `--html-report` | `.html` beside Markdown report | HTML report path |
| `--model` | `copilot:claude-sonnet-4.6` | Model name from `model.ts`; `chatModel()` chooses the runtime |
| `--think` | `false` | Ollama thinking mode; keep disabled for structured output |
| `--chunk-size` | `5` | Number of issues analyzed per structured model call; failed chunks split smaller |
| `--page-size` | `100` | Jira page size |
| `--max-issues` | no limit | Stop after N issues for a smaller run |
| `--max-analyze-issues` | no limit | Analyze only first N exported issues |
| `--max-description-chars` | `2500` | Truncate descriptions sent to the model; export JSON keeps full descriptions |

## Output Contract

The export JSON contains:

- `source`: Jira base URL, JQL, export timestamp
- `issues`: key, URL, summary, description text, status, type, priority, assignee, reporter, timestamps, labels, components, parent, sprint names, story points when available

The analysis JSON contains:

- `rankedIssues`: ordered from most important to least important
- `duplicateGroups`: likely duplicate or overlapping work items
- `themes`: larger product/engineering themes found in the backlog
- `summary`: concise interpretation and recommended handling

`rankedIssues` also includes classification fields for human review: `workArea`, `productDomain`, `taskKind`, `systems`, `projectThemes`, and `actionBucket`.

Duplicate handling has two layers:

- The model can return duplicate groups while analyzing each chunk.
- After all chunks are merged, the script runs a deterministic cross-backlog duplicate pass over the analyzed issues. It compares normalized title/description tokens and boosts shared domain, kind, systems, and themes.

Final duplicate markings are candidate signals only: `possibleDuplicateOf`, `duplicateConfidence`, and `duplicateReason`. They should be reviewed by a human before any Jira cleanup.

## Analysis Rules

- Prefer user impact, blocker severity, revenue/customer impact, compliance/security risk, dependency unblocking, and recency when ranking.
- Treat missing descriptions as uncertainty and lower confidence, not as proof that the issue is unimportant.
- Detect possible duplicates from title, description, labels, components, systems, themes, and acceptance criteria overlap.
- Keep Jira issue keys stable in all output so humans can review manually.
- Do not invent Jira fields or claim that Jira was changed.
