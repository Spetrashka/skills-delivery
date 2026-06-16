import { DEFAULT_JQL, DEFAULT_EXPORT_PATH, DEFAULT_ANALYSIS_PATH, DEFAULT_REPORT_PATH, DEFAULT_HTML_REPORT_PATH } from './constants.ts';
import { DEFAULT_MODEL } from '../../model.ts';

export function booleanOption(value, defaultValue = false) {
    if (value === undefined || value === null || value === '') return defaultValue;
    return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

export function parseArgs(argv) {
    const args = { _: [] };
    for (let i = 0; i < argv.length; i += 1) {
        const token = argv[i];
        if (!token.startsWith('--')) { args._.push(token); continue; }
        const key = token.slice(2);
        const next = argv[i + 1];
        if (!next || next.startsWith('--')) { args[key] = true; continue; }
        args[key] = next;
        i += 1;
    }
    return args;
}

export function printHelp() {
    console.log(`Usage:
  bun ./scripts/task-sorter.ts export [--jql <jql>] [--out <file>]
  bun ./scripts/task-sorter.ts analyze [--input <file>] [--out <file>] [--model <model>] [--report <file.md>] [--html <file.html>]
  bun ./scripts/task-sorter.ts ideas [--input <analysis.json>] [--export <export.json>] [--out <ideas.json>] [--model <model>] [--report <file.md>] [--html <file.html>]
  bun ./scripts/task-sorter.ts render [--input <analysis.json>] [--report <file.md>] [--html <file.html>]
  bun ./scripts/task-sorter.ts run [options]

Defaults:
  JQL: ${DEFAULT_JQL}
  Export: ${DEFAULT_EXPORT_PATH}
  Analysis: ${DEFAULT_ANALYSIS_PATH}
  Report: ${DEFAULT_REPORT_PATH}
  HTML report: ${DEFAULT_HTML_REPORT_PATH}
  Model: ${DEFAULT_MODEL}
  Chunk size: 5 issues; override with --chunk-size
  Concurrency: 5 parallel chunks; override with --concurrency
  Duplicate review limit: 250 ranked issues; override with --duplicate-review-max-issues
  Idea synthesis limit: 250 ranked issues per batch; override with --idea-synthesis-max-issues
  Ollama thinking: disabled by default for structured output; pass --think true to enable
  Analysis description limit: 2500 chars per issue; override with --max-description-chars
  Reporter filter: 'josh' by default; override with --reporter-filter <name>
`);
}
