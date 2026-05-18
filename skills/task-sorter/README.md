# QIN Task Sorter

Read-only backlog triage for QIN Jira. The tool exports issues to JSON, analyzes them with the selected LangChain chat model from `model.ts`, and writes sorted JSON plus Markdown and HTML reports. It never updates Jira.

## Prerequisites

- [Bun](https://bun.sh) runtime installed
- Jira credentials (see [Auth](#auth))
- At least one model provider credential (see [Models](#models))

### Install Bun

```bash
# macOS / Linux
curl -fsSL https://bun.sh/install | bash

# check install
bun --version
```

Windows (PowerShell): follow https://bun.sh/docs/installation, then run `bun --version`.

## Quick Start (Copilot-first)

1. Install dependencies:

```bash
cd skills/task-sorter
bun install
```

2. Authenticate:
   - Jira: create `~/.config/jira-mcp/.env` (see [Auth](#auth))
   - Copilot model token:

```bash
gh auth login
export GITHUB_TOKEN=$(gh auth token)
```

3. Run with Copilot Claude Sonnet 4.6:

```bash
bun ./scripts/task-sorter.ts run --model copilot:claude-sonnet-4.6
```

4. In Copilot Chat, call the skill directly with a prompt like:
   - `Use task-sorter skill: export QIN backlog and analyze with copilot:claude-sonnet-4.6`
   - `Run task-sorter on first 50 issues with copilot:claude-sonnet-4.6 and generate md/html reports`

### Prepare this skill from zero (copy-paste)

```bash
cd skills/task-sorter
curl -fsSL https://bun.sh/install | bash
source ~/.bashrc 2>/dev/null || true
bun install
gh auth login
export GITHUB_TOKEN=$(gh auth token)
bun ./scripts/task-sorter.ts run --model copilot:claude-sonnet-4.6 --max-issues 50
```

## Auth

### Jira

Create `~/.config/jira-mcp/.env` with:

```env
JIRA_BASE_URL=https://your-org.atlassian.net
JIRA_EMAIL=you@example.com
JIRA_API_TOKEN=your-jira-api-token
```

Get a Jira API token at: https://id.atlassian.com/manage-profile/security/api-tokens

### Models

Place model credentials in `skills/task-sorter/.env` (or export them as environment variables):

```env
# GitHub Copilot (recommended) — OAuth token from `gh auth login`
GITHUB_TOKEN=gho_...

# OpenAI — direct API key
OPENAI_API_KEY=sk-...

# Google Gemini — direct API key
GOOGLE_GEMINI_API_KEY=...

# Ollama — optional, defaults to http://localhost:11434
OLLAMA_BASE_URL=http://localhost:11434
```

#### Getting a GitHub Copilot OAuth token

```bash
# 1. Install GitHub CLI
brew install gh          # macOS
sudo apt install gh      # Ubuntu/Debian

# 2. Login
gh auth login

# 3. Use token in current shell (recommended)
export GITHUB_TOKEN=$(gh auth token)

# or persist in local .env (only if you prefer file-based env)
echo "GITHUB_TOKEN=$(gh auth token)" >> .env
```

The Copilot API base URL is `https://api.githubcopilot.com`. The token must be an OAuth token (`gho_`), not a Personal Access Token (`ghp_`).

## Models

The `--model` flag accepts any value from the `Model` enum in `model.ts`. The script routes to the correct runtime based on the prefix or known name:

| Prefix / Name | Runtime | Required credential |
|---|---|---|
| `copilot:*` | GitHub Copilot API (`api.githubcopilot.com`) | `GITHUB_TOKEN` or `GITHUB_PACKAGES_TOKEN` |
| `gpt-*`, `o3-*`, `o4-*` | OpenAI | `OPENAI_API_KEY` |
| `gemini-*` | Google Gemini | `GOOGLE_GEMINI_API_KEY` or `GOOGLE_API_KEY` |
| anything else | Ollama (local) | none (needs Ollama running) |

**Copilot models available:**

| `--model` value | Description |
|---|---|
| `copilot:claude-sonnet-4.6` *(default)* | Claude Sonnet 4.6 via Copilot |
| `copilot:claude-sonnet-4.5` | Claude Sonnet 4.5 via Copilot |
| `copilot:claude-opus-4.6` | Claude Opus 4.6 via Copilot |
| `copilot:gpt-4o` | GPT-4o via Copilot |
| `copilot:gpt-4.1` | GPT-4.1 via Copilot |
| `copilot:gpt-4.1-mini` | GPT-4.1 mini via Copilot |
| `copilot:o4-mini` | o4-mini via Copilot |
| `copilot:gemini-2.5-pro` | Gemini 2.5 Pro via Copilot |

## Run

```bash
# Export and analyze in one pass (default model: copilot:claude-sonnet-4.6)
GITHUB_TOKEN=$(gh auth token) bun ./scripts/task-sorter.ts run

# Use a specific model
bun ./scripts/task-sorter.ts run --model copilot:gpt-4o
bun ./scripts/task-sorter.ts run --model gpt-4.1
bun ./scripts/task-sorter.ts run --model gemini-2.5-pro
bun ./scripts/task-sorter.ts run --model llama3.2

# Limit to first 50 issues for a quick test
bun ./scripts/task-sorter.ts run --max-issues 50
```

Useful split workflow — export once, analyze multiple times with different models:

```bash
bun ./scripts/task-sorter.ts export --out ./out/qin-backlog.json
bun ./scripts/task-sorter.ts analyze --input ./out/qin-backlog.json --model copilot:gpt-4o
```

Regenerate reports from an existing analysis JSON without calling the model again:

```bash
bun ./scripts/task-sorter.ts render --input ./out/qin-backlog.analysis.json --report ./out/qin-backlog.report.md --html ./out/qin-backlog.report.html
```

## All Options

| Option | Default | Description |
|---|---|---|
| `--jql` | `project=QIN AND statusCategory != Done ORDER BY Rank ASC` | Jira issue search query |
| `--model` | `copilot:claude-sonnet-4.6` | Model name; see [Models](#models) table |
| `--out` | command-specific file under `./out` | Output file path |
| `--input` | latest export for `analyze`/`render` | Input JSON file |
| `--report` | `.md` beside analysis JSON | Markdown report path |
| `--html` / `--html-report` | `.html` beside Markdown report | HTML report path |
| `--chunk-size` | `5` | Issues per model call; failed chunks split smaller automatically |
| `--page-size` | `100` | Jira pagination page size |
| `--max-issues` | no limit | Stop export after N issues |
| `--max-analyze-issues` | no limit | Analyze only first N exported issues |
| `--max-description-chars` | `2500` | Truncate descriptions sent to the model (export JSON keeps full text) |
| `--think` | `false` | Ollama thinking mode; keep disabled for structured output |

## Processing Flow

1. **Export:** Jira is queried with JQL and the matching issues are saved with summaries, descriptions, status, priority, labels, components, parent, sprint names, and story points.
2. **Chunk analysis:** issues are sent to the selected chat model in small chunks. The model must return Zod-validated structured output: ranked issues, themes, and possible duplicates inside that chunk.
3. **Fallbacks:** if a chunk fails structured parsing, the script splits it smaller. If a single issue still fails, deterministic scoring is used for that issue and a warning is added.
4. **Normalization:** model scores are normalized to `0..100`, aligned with importance, sorted, and ranked.
5. **Classification:** each task is tagged with `workArea`, `productDomain`, `taskKind`, `systems`, `projectThemes`, and `actionBucket`.
6. **Final duplicate pass:** after all issues are analyzed, the script compares the full analyzed set for cross-chunk possible duplicates. This pass uses normalized title/description tokens plus shared domain, kind, systems, and themes. It marks candidates as `possibleDuplicateOf`; it does not claim they are confirmed duplicates.
7. **Output:** JSON, Markdown report, and HTML report are written under `out/` or the paths passed with `--out`, `--report`, and `--html`.

## Reading Results

- `rankedIssues` is the final sorted backlog. Rank 1 is the first item to review.
- `importance` is the model's qualitative priority: `critical`, `high`, `medium`, or `low`.
- `score` is the normalized numeric priority from `0` to `100`.
- `confidence` says how confident the model was in its classification, not how important the issue is.
- `workArea` separates work such as `frontend`, `backend`, `fullstack`, `devops`, `qa`, `data`, `product`, or `unknown`.
- `productDomain` groups business area: integrations, resident management, leasing, billing, notifications, reporting, identity/access, operations, platform, or unknown.
- `taskKind` identifies bug, feature, tech debt, research, QA planning, migration, observability, documentation, support, epic, or unknown.
- `actionBucket` is the practical queue: `do_now`, `schedule_next`, `groom_first`, `deduplicate`, `defer`, or `close_candidate`.
- `duplicateGroups` are possible duplicate or overlapping work groups for human review. The tool recommends a canonical key, usually the higher-ranked issue, but does not modify Jira.
- `possibleDuplicateOf`, `duplicateConfidence`, and `duplicateReason` explain why an issue was marked as a duplicate candidate.
- `warnings` indicate where fallback logic was used or where model output needed recovery.

## Duplicate Detection

Duplicate detection has two layers:

- **Model layer:** the selected model may mark duplicates while analyzing each chunk.
- **Final deterministic layer:** after all chunks are merged, the script compares all analyzed tasks to catch cross-chunk duplicate candidates.

The final layer is semantic-ish but deterministic: it compares normalized words from titles and descriptions, then boosts matches that share product domain, task kind, systems, or project themes. It intentionally marks results as possible duplicates because Jira cleanup still needs human confirmation.
