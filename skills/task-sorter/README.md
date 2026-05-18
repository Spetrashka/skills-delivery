# QIN Task Sorter

Read-only backlog triage for QIN Jira. The tool exports issues to JSON, analyzes them with the selected LangChain chat model from `model.ts`, and writes sorted JSON plus Markdown and HTML reports. It never updates Jira.

## Run

```bash
bun ./scripts/task-sorter.ts run --model gpt-oss:20b
```

Useful split workflow:

```bash
bun ./scripts/task-sorter.ts export --out ./out/qin-backlog.json
bun ./scripts/task-sorter.ts analyze --input ./out/qin-backlog.json --out ./out/qin-backlog.analysis.json --model gpt-oss:20b
```

The only model selector is `--model`. The script passes that value to `chatModel()` in `model.ts`; that switch decides whether it is OpenAI, Gemini, Ollama, or another supported runtime.

Regenerate reports from an existing analysis JSON without calling the model again:

```bash
bun ./scripts/task-sorter.ts render --input ./out/qin-backlog.analysis.json --report ./out/qin-backlog.report.md --html ./out/qin-backlog.report.html
```

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
