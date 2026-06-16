import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const SKILL_DIR = resolve(__dirname, '../..');

export const DEFAULT_PROJECT = 'QIN';
export const DEFAULT_OUT_DIR = resolve(process.cwd(), 'out');

export function defaultJql(project = DEFAULT_PROJECT) {
    return `project=${project} AND statusCategory != Done ORDER BY Rank ASC`;
}

export function defaultPaths(project = DEFAULT_PROJECT) {
    const slug = project.toLowerCase();
    return {
        export:    resolve(DEFAULT_OUT_DIR, `${slug}-backlog.json`),
        analysis:  resolve(DEFAULT_OUT_DIR, `${slug}-backlog.analysis.json`),
        report:    resolve(DEFAULT_OUT_DIR, `${slug}-backlog.report.md`),
        htmlReport: resolve(DEFAULT_OUT_DIR, `${slug}-backlog.report.html`),
        ideas:     resolve(DEFAULT_OUT_DIR, `${slug}-backlog.ideas.json`),
    };
}

// Backward-compat aliases for code that still imports the old constants directly.
export const DEFAULT_JQL          = defaultJql(DEFAULT_PROJECT);
export const DEFAULT_EXPORT_PATH  = defaultPaths(DEFAULT_PROJECT).export;
export const DEFAULT_ANALYSIS_PATH = defaultPaths(DEFAULT_PROJECT).analysis;
export const DEFAULT_REPORT_PATH  = defaultPaths(DEFAULT_PROJECT).report;
export const DEFAULT_HTML_REPORT_PATH = defaultPaths(DEFAULT_PROJECT).htmlReport;
export const DEFAULT_IDEAS_PATH   = defaultPaths(DEFAULT_PROJECT).ideas;

export const FIELDS = [
    'summary',
    'description',
    'status',
    'issuetype',
    'priority',
    'assignee',
    'reporter',
    'created',
    'updated',
    'labels',
    'components',
    'parent',
    'issuelinks',
    'sprint',
    'customfield_10016',
    'customfield_10020',
];
