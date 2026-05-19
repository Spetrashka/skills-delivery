import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const SKILL_DIR = resolve(__dirname, '../..');

export const DEFAULT_JQL = 'project=QIN AND statusCategory != Done ORDER BY Rank ASC';
export const DEFAULT_OUT_DIR = resolve(process.cwd(), 'out');
export const DEFAULT_EXPORT_PATH = resolve(DEFAULT_OUT_DIR, 'qin-backlog.json');
export const DEFAULT_ANALYSIS_PATH = resolve(DEFAULT_OUT_DIR, 'qin-backlog.analysis.json');
export const DEFAULT_REPORT_PATH = resolve(DEFAULT_OUT_DIR, 'qin-backlog.report.md');
export const DEFAULT_HTML_REPORT_PATH = resolve(DEFAULT_OUT_DIR, 'qin-backlog.report.html');

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
