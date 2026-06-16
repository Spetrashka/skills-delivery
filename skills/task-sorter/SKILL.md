---
name: task-sorter
description: Export any Jira project backlog without modifying Jira, save issues with descriptions to JSON, then analyze and sort tasks by importance using a structured LangChain model with OpenAI, Google Gemini, or Ollama. Use when asked to review, deduplicate, prioritize, rank, or sort a Jira backlog or task list into an output file only. Defaults to the QIN project; use --project or TASK_SORTER_PROJECT to target any other project.
---

# Task Sorter

## Purpose

Use this skill to produce an offline backlog analysis for any Jira project:

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

For Copilot models, prefer `GITHUB_TOKEN=$(gh auth token)`. The Copilot API does not accept Personal Access Tokens such as `ghp_...` or `github_pat_...`.

## Commands

| Command | Description |
| --- | --- |
| `export` | Export Jira issues only |
| `analyze` | Analyze an existing exported JSON file |
| `ideas` | Re-synthesize epic-level ideas from an existing analysis JSON (dedicated output, no re-analysis) |
| `render` | Regenerate Markdown and HTML reports from an existing analysis JSON without calling a model |
| `run` | Export and analyze in one pass |

## Common Usage

```bash
# Full run on the default project (QIN)
bun ./scripts/task-sorter.ts run

# Full run on a different Jira project
bun ./scripts/task-sorter.ts run --project INFRA

# Or set the project via env var (useful in .env or CI)
TASK_SORTER_PROJECT=MYPROJ bun ./scripts/task-sorter.ts run

# Custom JQL (overrides the --project default query)
bun ./scripts/task-sorter.ts run --project INFRA --jql 'project=INFRA AND labels=backlog AND statusCategory != Done'

# Different model
bun ./scripts/task-sorter.ts run --model gpt-oss:20b
bun ./scripts/task-sorter.ts run --model copilot:claude-sonnet-4.6
bun ./scripts/task-sorter.ts run --model gemini-2.5-pro

# Export only
bun ./scripts/task-sorter.ts export --project MYPROJ

# Analyze a saved export only
bun ./scripts/task-sorter.ts analyze --project MYPROJ --input ./out/myproj-backlog.json

# Re-synthesize ideas from an existing analysis JSON (no re-analysis needed)
bun ./scripts/task-sorter.ts ideas --input ./out/myproj-backlog.analysis.json

# Ideas with richer context from the original export (passes descriptions to the model)
bun ./scripts/task-sorter.ts ideas --input ./out/myproj-backlog.analysis.json --export ./out/myproj-backlog.json

# Ideas with a specific model or reporter filter override
bun ./scripts/task-sorter.ts ideas --input ./out/myproj-backlog.analysis.json --model gpt-4.1

# Regenerate reports from existing analysis JSON
bun ./scripts/task-sorter.ts render --input ./out/myproj-backlog.analysis.json
```

## Options

| Option | Default | Description |
| --- | --- | --- |
| `--project` | `QIN` (env: `TASK_SORTER_PROJECT`) | Jira project key; drives default JQL, output file prefix, and report titles |
| `--jql` | `project=<PROJECT> AND statusCategory != Done ORDER BY Rank ASC` | Override the full Jira search query |
| `--out` | `<project>-backlog.*` under `./out` | Output path |
| `--input` | latest export/analysis under `./out` | Input JSON file for `analyze`, `ideas`, `render` |
| `--report` | `.md` beside analysis JSON | Markdown report path |
| `--html` / `--html-report` | `.html` beside Markdown report | HTML report path |
| `--model` | `gpt-5.5` | Model name from `model.ts`; `chatModel()` chooses the runtime |
| `--reporter-filter` | `Joshua Barron` (env: `TASK_SORTER_REPORTER_FILTER`) | Name pattern for the "by reporter" category split |
| `--think` | `false` | Ollama thinking mode; keep disabled for structured output |
| `--chunk-size` | `5` | Number of issues analyzed per structured model call; failed chunks split smaller |
| `--concurrency` | `5` | Parallel chunk workers |
| `--page-size` | `100` | Jira page size |
| `--max-issues` | no limit | Stop after N issues for a smaller run |
| `--max-analyze-issues` | no limit | Analyze only first N exported issues |
| `--max-description-chars` | `2500` | Truncate descriptions sent to the model; export JSON keeps full descriptions |
| `--duplicate-review-max-issues` | `250` | Maximum ranked issues sent to the final model duplicate review |
| `--idea-synthesis-max-issues` | `250` | Maximum ranked issues per idea-synthesis model call; larger backlogs are batched and collapsed |

## Output Contract

The export JSON contains:

- `source`: Jira base URL, project key, JQL, export timestamp
- `issues`: key, URL, summary, description text, status, type, priority, assignee, reporter, timestamps, labels, components, parent, sprint names, story points when available

The analysis JSON contains:

- `rankedIssues`: ordered from most important to least important
- `ideas`: global, epic-level initiatives synthesized from the whole backlog. Each idea has a `title`, `problemStatement`, `goal`, `rationale`, `importance`, `scopeEstimate`, `productDomain`, and `relatedIssues` (each tagged `core` or `supporting` with a reason). Every ranked issue is assigned to at least one idea.
- `duplicateGroups`: likely duplicate or overlapping work items
- `themes`: lightweight per-category product/engineering themes found in the backlog (complementary to the richer global `ideas`)
- `summary`: concise interpretation and recommended handling, including `ideaCount` and `duplicateGroupCount`

`rankedIssues` also includes classification fields for human review: `workArea`, `productDomain`, `taskKind`, `planningCategory`, `systems`, `projectThemes`, and `actionBucket`.

Ideas are built with a map-reduce/collapse pattern: each chunk proposes lightweight candidate ideas during analysis (map), then a global synthesis pass consolidates them into deduplicated epics and assigns every task a `core`/`supporting` role (reduce). Large backlogs are synthesized in batches and collapsed; if the model call fails or is skipped, a deterministic product-domain grouping is used so the contract always holds.

Duplicate handling has three layers:

- The model can return duplicate groups while analyzing each chunk.
- After all chunks are merged and ranked, the model reviews a compact ranked issue list for cross-chunk duplicate or overlapping work.
- After model duplicate groups are merged, the script runs a deterministic cross-backlog safety-net pass. It compares normalized title/description tokens and boosts shared domain, kind, systems, and themes.

Final duplicate markings are candidate signals only: `possibleDuplicateOf`, `duplicateConfidence`, and `duplicateReason`. They should be reviewed by a human before any Jira cleanup.

## Analysis Rules

- Prefer user impact, blocker severity, revenue/customer impact, compliance/security risk, dependency unblocking, and recency when ranking.
- Treat missing descriptions as uncertainty and lower confidence, not as proof that the issue is unimportant.
- Detect possible duplicates from title, description, labels, components, systems, themes, and acceptance criteria overlap.
- Keep Jira issue keys stable in all output so humans can review manually.
- Do not invent Jira fields or claim that Jira was changed.
