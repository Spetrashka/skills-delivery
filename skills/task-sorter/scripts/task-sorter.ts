#!/usr/bin/env bun

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { z } from 'zod';
import { chatModel, Model } from '../model.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = resolve(__dirname, '..');

config({ path: resolve(process.env.HOME, '.config/jira-mcp/.env') });
config({ path: resolve(SKILL_DIR, '.env'), override: true });

const DEFAULT_JQL = 'project=QIN AND statusCategory != Done ORDER BY Rank ASC';
const DEFAULT_OUT_DIR = resolve(process.cwd(), 'out');
const DEFAULT_EXPORT_PATH = resolve(DEFAULT_OUT_DIR, 'qin-backlog.json');
const DEFAULT_ANALYSIS_PATH = resolve(DEFAULT_OUT_DIR, 'qin-backlog.analysis.json');
const DEFAULT_REPORT_PATH = resolve(DEFAULT_OUT_DIR, 'qin-backlog.report.md');
const DEFAULT_HTML_REPORT_PATH = resolve(DEFAULT_OUT_DIR, 'qin-backlog.report.html');

const FIELDS = [
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

const WorkAreaSchema = z.enum(['frontend', 'backend', 'fullstack', 'devops', 'qa', 'data', 'product', 'unknown']);
const ProductDomainSchema = z.enum(['integrations', 'resident_management', 'leasing', 'billing', 'notifications', 'reporting', 'identity_access', 'operations', 'platform', 'unknown']);
const TaskKindSchema = z.enum(['bug', 'feature', 'tech_debt', 'research', 'qa_planning', 'migration', 'observability', 'documentation', 'support', 'epic', 'unknown']);
const ActionBucketSchema = z.enum(['do_now', 'schedule_next', 'groom_first', 'deduplicate', 'defer', 'close_candidate']);

const AnalysisSchema = z.object({
    summary: z.object({
        totalIssuesReviewed: z.number(),
        highPriorityCount: z.number(),
        duplicateGroupCount: z.number(),
        overallAssessment: z.string(),
        recommendedNextStep: z.string(),
    }),
    rankedIssues: z.array(z.object({
        rank: z.number(),
        key: z.string(),
        title: z.string(),
        importance: z.enum(['critical', 'high', 'medium', 'low']),
        confidence: z.enum(['high', 'medium', 'low']),
        score: z.number().min(0).max(100),
        reasoning: z.string(),
        suggestedAction: z.string(),
        riskIfDelayed: z.string(),
        duplicateOf: z.string().nullable().default(null),
        possibleDuplicateOf: z.string().nullable().default(null),
        duplicateConfidence: z.enum(['high', 'medium', 'low']).nullable().default(null),
        duplicateReason: z.string().default(''),
        workArea: WorkAreaSchema.default('unknown'),
        productDomain: ProductDomainSchema.default('unknown'),
        taskKind: TaskKindSchema.default('unknown'),
        systems: z.array(z.string()).default([]),
        projectThemes: z.array(z.string()).default([]),
        actionBucket: ActionBucketSchema.default('groom_first'),
    })),
    duplicateGroups: z.array(z.object({
        groupId: z.string(),
        issueKeys: z.array(z.string()),
        confidence: z.enum(['high', 'medium', 'low']),
        reason: z.string(),
        recommendedCanonicalKey: z.string(),
    })).default([]),
    themes: z.array(z.object({
        name: z.string(),
        issueKeys: z.array(z.string()).default([]),
        importance: z.enum(['critical', 'high', 'medium', 'low']).default('medium'),
        notes: z.string().default(''),
    })).default([]),
    groups: z.object({
        byWorkArea: z.record(z.array(z.string())).default({}),
        byProductDomain: z.record(z.array(z.string())).default({}),
        byTaskKind: z.record(z.array(z.string())).default({}),
        byActionBucket: z.record(z.array(z.string())).default({}),
        byProjectTheme: z.record(z.array(z.string())).default({}),
        bySystem: z.record(z.array(z.string())).default({}),
    }).default({}),
});

const ChunkAnalysisSchema = z.object({
    rankedIssues: AnalysisSchema.shape.rankedIssues,
    duplicateGroups: AnalysisSchema.shape.duplicateGroups,
    themes: AnalysisSchema.shape.themes,
});

function booleanOption(value, defaultValue = false) {
    if (value === undefined || value === null || value === '') return defaultValue;
    return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function parseArgs(argv) {
    const args = { _: [] };
    for (let i = 0; i < argv.length; i += 1) {
        const token = argv[i];
        if (!token.startsWith('--')) {
            args._.push(token);
            continue;
        }
        const key = token.slice(2);
        const next = argv[i + 1];
        if (!next || next.startsWith('--')) {
            args[key] = true;
            continue;
        }
        args[key] = next;
        i += 1;
    }
    return args;
}

function requireJiraConfig() {
    const baseUrl = process.env.JIRA_BASE_URL?.replace(/\/$/, '');
    const email = process.env.JIRA_EMAIL;
    const token = process.env.JIRA_API_TOKEN;

    if (!baseUrl || !email || !token) {
        throw new Error('Missing JIRA_BASE_URL, JIRA_EMAIL, or JIRA_API_TOKEN in ~/.config/jira-mcp/.env');
    }

    return {
        baseUrl,
        authHeader: `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`,
    };
}

async function jiraFetch(path, options = {}) {
    const { baseUrl, authHeader } = requireJiraConfig();
    const res = await fetch(`${baseUrl}/rest/api/3${path}`, {
        ...options,
        headers: {
            Authorization: authHeader,
            Accept: 'application/json',
            'Content-Type': 'application/json',
            ...options.headers,
        },
    });

    if (!res.ok) {
        throw new Error(`Jira API ${res.status}: ${await res.text()}`);
    }

    return res.json();
}

function adfToText(node) {
    if (!node) return '';
    if (typeof node === 'string') return node;
    if (Array.isArray(node)) return node.map(adfToText).filter(Boolean).join('\n');
    if (node.type === 'text') return node.text || '';
    if (!node.content) return '';

    const separator = ['paragraph', 'heading', 'bulletList', 'orderedList', 'listItem'].includes(node.type) ? '\n' : '';
    return node.content.map(adfToText).filter(Boolean).join(separator).replace(/\n{3,}/g, '\n\n').trim();
}

function names(items) {
    return Array.isArray(items) ? items.map((item) => item?.name).filter(Boolean) : [];
}

function sprintNames(value) {
    if (!Array.isArray(value)) return [];
    return value.map((sprint) => sprint?.name || String(sprint)).filter(Boolean);
}

function normalizeIssue(issue, baseUrl) {
    const f = issue.fields || {};
    return {
        key: issue.key,
        url: `${baseUrl}/browse/${issue.key}`,
        summary: f.summary || '',
        description: adfToText(f.description),
        status: f.status?.name || null,
        statusCategory: f.status?.statusCategory?.name || null,
        type: f.issuetype?.name || null,
        priority: f.priority?.name || null,
        assignee: f.assignee?.displayName || null,
        reporter: f.reporter?.displayName || null,
        created: f.created || null,
        updated: f.updated || null,
        labels: Array.isArray(f.labels) ? f.labels : [],
        components: names(f.components),
        parent: f.parent?.key || null,
        sprintNames: sprintNames(f.customfield_10020 || f.sprint),
        storyPoints: f.customfield_10016 ?? null,
    };
}

async function exportIssues(options) {
    const { baseUrl } = requireJiraConfig();
    const jql = options.jql || DEFAULT_JQL;
    const pageSize = Number(options['page-size'] || 100);
    const maxIssues = options['max-issues'] ? Number(options['max-issues']) : Infinity;
    const outPath = resolve(options.out || DEFAULT_EXPORT_PATH);
    const issues = [];
    let nextPageToken;
    let isLast = false;

    while (!isLast && issues.length < maxIssues) {
        const data = await jiraFetch('/search/jql', {
            method: 'POST',
            body: JSON.stringify({
                jql,
                maxResults: Math.min(pageSize, maxIssues - issues.length),
                nextPageToken,
                fields: FIELDS,
            }),
        });

        for (const issue of data.issues || []) {
            issues.push(normalizeIssue(issue, baseUrl));
            if (issues.length >= maxIssues) break;
        }

        nextPageToken = data.nextPageToken;
        isLast = data.isLast === true || !nextPageToken || !data.issues?.length;
    }

    const payload = {
        source: {
            jiraBaseUrl: baseUrl,
            jql,
            exportedAt: new Date().toISOString(),
            readOnly: true,
        },
        count: issues.length,
        issues,
    };

    await writeJson(outPath, payload);
    return { outPath, count: issues.length };
}

function analysisMessages(exportPayload, issues) {
    return [
        {
            role: 'system',
            content: [
                'You are a backlog triage analyst.',
                'Analyze only the provided Jira export. Do not suggest or claim Jira mutations.',
                'Analyze this chunk only. Rank issues by practical importance: user/customer impact, blockers, revenue, compliance/security risk, dependency unblocking, severity, freshness, and clarity.',
                'Detect duplicates and overlapping tasks conservatively. Use low confidence when evidence is weak.',
                'Return every reviewed issue in rankedIssues exactly once unless the input is empty.',
                'Do not include hidden reasoning, chain of thought, markdown, or prose outside the structured response.',
            ].join('\n'),
        },
        {
            role: 'user',
            content: JSON.stringify({
                source: exportPayload.source,
                issues,
            }),
        },
    ];
}

function truncateText(text, maxChars) {
    const value = String(text || '');
    if (!maxChars || value.length <= maxChars) return value;
    return `${value.slice(0, maxChars)}\n\n[truncated ${value.length - maxChars} chars]`;
}

function chunkItems(items, chunkSize) {
    const chunks = [];
    for (let i = 0; i < items.length; i += chunkSize) {
        chunks.push(items.slice(i, i + chunkSize));
    }
    return chunks;
}

function clampScore(score) {
    return Math.max(0, Math.min(100, Math.round(score)));
}

function importanceFromScore(score) {
    if (score >= 85) return 'critical';
    if (score >= 70) return 'high';
    if (score >= 35) return 'medium';
    return 'low';
}

function normalizeModelScore(score) {
    const value = Number(score || 0);
    if (value > 0 && value <= 10) return clampScore(value * 10);
    return clampScore(value);
}

function actionBucketFromScore(score, fallback = 'groom_first') {
    if (score >= 85) return 'do_now';
    if (score >= 70) return 'schedule_next';
    if (score < 30) return 'defer';
    return fallback;
}

function alignScoreWithImportance(score, importance) {
    const minimum = { critical: 90, high: 75, medium: 40, low: 0 }[importance] ?? 0;
    return Math.max(score, minimum);
}

function daysSince(dateValue) {
    const time = Date.parse(dateValue || '');
    if (Number.isNaN(time)) return Infinity;
    return Math.max(0, (Date.now() - time) / 86_400_000);
}

function heuristicIssueScore(issue) {
    const text = `${issue.title || ''}\n${issue.description || ''}\n${issue.priority || ''}\n${issue.type || ''}`.toLowerCase();
    let score = 25;
    const reasons = [];

    if (/critical|highest|blocker|p0|p1|4:\s*high/.test(text)) {
        score += 25;
        reasons.push('high Jira priority or blocker wording');
    } else if (/medium|problematic|p2|p3|3:\s*medium/.test(text)) {
        score += 12;
        reasons.push('medium Jira priority');
    } else if (/low|trivial|lowest/.test(text)) {
        score -= 5;
        reasons.push('low Jira priority');
    }

    if (/production|prod|outage|incident|support/.test(text)) {
        score += 20;
        reasons.push('production/support impact');
    }
    if (/data loss|missing|corrupt|integrity|migration|consolidation|sync/.test(text)) {
        score += 18;
        reasons.push('data integrity or migration risk');
    }
    if (/security|privacy|pii|compliance|audit/.test(text)) {
        score += 18;
        reasons.push('security/compliance signal');
    }
    if (/block|dependency|unblock|release|onboarding|customer|client|partner/.test(text)) {
        score += 12;
        reasons.push('dependency, release, or customer signal');
    }
    if (/metrics|prometheus|grafana|alert|monitor|observability|incident management/.test(text)) {
        score += 10;
        reasons.push('operational visibility signal');
    }
    if (/bug|failure|failed|error|fix/.test(text)) {
        score += 10;
        reasons.push('bug/failure signal');
    }
    if (/epic|capability|strategy/.test(String(issue.type || '').toLowerCase())) {
        score += 8;
        reasons.push('large initiative type');
    }
    if (String(issue.statusCategory || '').toLowerCase() === 'in progress') {
        score += 6;
        reasons.push('already in progress');
    }

    const age = daysSince(issue.updated);
    if (age <= 14) {
        score += 8;
        reasons.push('recently updated');
    } else if (age > 90) {
        score -= 8;
        reasons.push('stale update date');
    }

    return {
        score: clampScore(score),
        reasons,
    };
}

function classifyIssue(issue) {
    const text = `${issue.key || ''}\n${issue.title || ''}\n${issue.description || ''}\n${issue.type || ''}\n${issue.priority || ''}\n${(issue.labels || []).join(' ')}\n${(issue.components || []).join(' ')}`.toLowerCase();
    const title = String(issue.title || '');
    const systems = new Set(issue.components || []);
    const projectThemes = new Set();

    const addSystem = (name) => systems.add(name);
    const addTheme = (name) => projectThemes.add(name);

    if (/realpage/.test(text)) {
        addSystem('RealPage');
        addTheme('RealPage integration');
    }
    if (/entrata/.test(text)) {
        addSystem('Entrata');
        addTheme('Entrata migration');
    }
    if (/yardi/.test(text)) {
        addSystem('Yardi');
        addTheme('Yardi migration');
    }
    if (/cv3|cv 3/.test(text)) {
        addSystem('CV3');
        addTheme('CV3 migration');
    }
    if (/ipsv?3|ips/.test(text)) {
        addSystem('IPS');
        addTheme('IPS');
    }
    if (/falcon/.test(text)) {
        addSystem('Falcon');
        addTheme('Falcon migration');
    }
    if (/prometheus|grafana|metrics/.test(text)) {
        addSystem('Prometheus/Grafana');
        addTheme('Observability');
    }
    if (/iot/.test(text)) {
        addSystem('IoT');
        addTheme('IoT');
    }
    if (/engrain/.test(text)) {
        addSystem('Engrain');
        addTheme('Engrain integration');
    }
    if (/consolidation/.test(text)) {
        addSystem('Consolidation');
        addTheme('Consolidation');
    }
    if (/onboarding/.test(text)) addTheme('Community onboarding');
    if (/production support|support/.test(text)) addTheme('Production support');
    if (/lease|leasing/.test(text)) addTheme('Leasing');
    if (/alert|incident/.test(text)) addTheme('Alerts and incident management');

    let workArea = 'unknown';
    if (/ui\/ux|frontend|screen|falcon|design system|button|modal|page|form/.test(text)) {
        workArea = 'frontend';
    }
    if (/api|backend|database|sql|service|processor|ingestion|sync|migration|endpoint|payload|s3|cdc/.test(text)) {
        workArea = workArea === 'frontend' ? 'fullstack' : 'backend';
    }
    if (/prometheus|grafana|metrics|alert|incident|deployment|release process|monitor/.test(text)) {
        workArea = 'devops';
    }
    if (/test data|qa|test case|scenario|uat/.test(text)) {
        workArea = workArea === 'backend' ? 'fullstack' : 'qa';
    }
    if (/data|mapping|migration|sync|ingestion|payload|etl|s3/.test(text)) {
        workArea = workArea === 'unknown' ? 'data' : workArea;
    }
    if (/strategy|scope|requirements|proposal|define/.test(text) && workArea === 'unknown') {
        workArea = 'product';
    }

    let productDomain = 'unknown';
    if (/integration|partner|realpage|entrata|yardi|engrain|ips/.test(text)) productDomain = 'integrations';
    if (/resident|guest|person/.test(text)) productDomain = 'resident_management';
    if (/lease|leasing/.test(text)) productDomain = 'leasing';
    if (/payment|billing|invoice|ledger/.test(text)) productDomain = 'billing';
    if (/notification|notify|email|message/.test(text)) productDomain = 'notifications';
    if (/report|dashboard|metric|grafana/.test(text)) productDomain = 'reporting';
    if (/auth|permission|role|access/.test(text)) productDomain = 'identity_access';
    if (/operations|support|incident|alert|monitor|release/.test(text)) productDomain = 'operations';
    if (/platform|falcon|cv3|architecture|multi-version/.test(text)) productDomain = 'platform';

    let taskKind = 'unknown';
    if (/bug|failed|failure|error|fix|missing|not send|take about/.test(text)) taskKind = 'bug';
    if (/epic/.test(String(issue.type || '').toLowerCase())) taskKind = 'epic';
    if (/feature|enable|automated|expose|fetch|create|implement/.test(text) && taskKind === 'unknown') taskKind = 'feature';
    if (/tech debt|refactor|optimization|performance|standardization/.test(text)) taskKind = 'tech_debt';
    if (/research|investigate|proposal|propose/.test(text)) taskKind = 'research';
    if (/test data|qa|test case|scenario/.test(text)) taskKind = 'qa_planning';
    if (/migration|cv3|falcon/.test(text)) taskKind = 'migration';
    if (/metrics|prometheus|grafana|alert|monitor|observability|incident/.test(text)) taskKind = 'observability';
    if (/document|documentation|release process/.test(text)) taskKind = 'documentation';
    if (/support|production support/.test(text)) taskKind = 'support';

    const heuristic = heuristicIssueScore(issue);
    let actionBucket = 'groom_first';
    if (heuristic.score >= 85) actionBucket = 'do_now';
    else if (heuristic.score >= 70) actionBucket = 'schedule_next';
    else if (daysSince(issue.updated) > 120 || /lowest|trivial/.test(text)) actionBucket = 'defer';

    return {
        workArea,
        productDomain,
        taskKind,
        systems: [...systems].filter(Boolean).slice(0, 8),
        projectThemes: [...projectThemes].filter(Boolean).slice(0, 8),
        actionBucket,
    };
}

function safeErrorMessage(err) {
    return truncateText(err?.message || String(err), 500).replace(/\s+/g, ' ');
}

function fallbackIssueAnalysis(issue, reason = 'Model could not return valid structured output for this issue.') {
    const heuristic = heuristicIssueScore(issue);
    return {
        rank: 0,
        key: issue.key,
        title: issue.title || issue.key,
        importance: importanceFromScore(heuristic.score),
        confidence: 'medium',
        score: heuristic.score,
        reasoning: `Structured model output failed; deterministic fallback score used. Signals: ${heuristic.reasons.join(', ') || 'limited explicit priority signals'}. Failure: ${reason}`,
        suggestedAction: heuristic.score >= 70
            ? 'Review near the top of backlog grooming and validate priority with the owner.'
            : 'Review during backlog grooming and confirm whether the issue is still current.',
        riskIfDelayed: heuristic.reasons.includes('data integrity or migration risk')
            ? 'Potential data integrity or migration risk if delayed.'
            : heuristic.reasons.includes('production/support impact')
                ? 'Potential production/support impact if delayed.'
                : 'Risk depends on product context; validate manually.',
        duplicateOf: null,
        possibleDuplicateOf: null,
        duplicateConfidence: null,
        duplicateReason: '',
        ...classifyIssue(issue),
    };
}

async function invokeChunkAnalysisModel(model, exportPayload, issues) {
    return model
        .withStructuredOutput(ChunkAnalysisSchema, { name: 'QinBacklogChunkAnalysis', method: 'functionCalling' })
        .invoke(analysisMessages(exportPayload, issues));
}

async function analyzeChunkWithSplit(model, exportPayload, issues, warnings) {
    try {
        const result = await invokeChunkAnalysisModel(model, exportPayload, issues);
        const returnedKeys = new Set((result.rankedIssues || []).map((issue) => issue.key));
        const missing = issues
            .filter((issue) => !returnedKeys.has(issue.key))
            .map((issue) => fallbackIssueAnalysis(issue, 'Model omitted this issue from the structured chunk output.'));

        return {
            rankedIssues: [...(result.rankedIssues || []), ...missing],
            duplicateGroups: result.duplicateGroups || [],
            themes: result.themes || [],
        };
    } catch (err) {
        if (issues.length <= 1) {
            warnings.push(`Fallback used for ${issues[0]?.key}: ${safeErrorMessage(err)}`);
            return {
                rankedIssues: [fallbackIssueAnalysis(issues[0], safeErrorMessage(err))],
                duplicateGroups: [],
                themes: [],
            };
        }

        warnings.push(`Chunk of ${issues.length} issues failed structured parsing; splitting into smaller chunks.`);
        const middle = Math.ceil(issues.length / 2);
        const left = await analyzeChunkWithSplit(model, exportPayload, issues.slice(0, middle), warnings);
        const right = await analyzeChunkWithSplit(model, exportPayload, issues.slice(middle), warnings);
        return mergeChunkResults([left, right]);
    }
}

function importanceWeight(importance) {
    return { critical: 4, high: 3, medium: 2, low: 1 }[importance] || 0;
}

function mergeThemes(themes) {
    const byName = new Map();
    for (const theme of themes || []) {
        const key = String(theme.name || 'Untitled theme').toLowerCase();
        const existing = byName.get(key);
        if (!existing) {
            byName.set(key, {
                name: theme.name || 'Untitled theme',
                issueKeys: [...new Set(theme.issueKeys || [])],
                importance: theme.importance || 'medium',
                notes: theme.notes || '',
            });
            continue;
        }

        existing.issueKeys = [...new Set([...existing.issueKeys, ...(theme.issueKeys || [])])];
        if (importanceWeight(theme.importance) > importanceWeight(existing.importance)) {
            existing.importance = theme.importance;
        }
        if (!existing.notes && theme.notes) {
            existing.notes = theme.notes;
        }
    }
    return [...byName.values()];
}

function mergeChunkResults(results) {
    return {
        rankedIssues: results.flatMap((result) => result.rankedIssues || []),
        duplicateGroups: results.flatMap((result) => result.duplicateGroups || []),
        themes: mergeThemes(results.flatMap((result) => result.themes || [])),
    };
}

function addGroup(groups, groupName, key, issueKey) {
    if (!key) return;
    if (!groups[groupName][key]) groups[groupName][key] = [];
    if (!groups[groupName][key].includes(issueKey)) groups[groupName][key].push(issueKey);
}

function buildGroups(rankedIssues) {
    const groups = {
        byWorkArea: {},
        byProductDomain: {},
        byTaskKind: {},
        byActionBucket: {},
        byProjectTheme: {},
        bySystem: {},
    };

    for (const issue of rankedIssues) {
        addGroup(groups, 'byWorkArea', issue.workArea, issue.key);
        addGroup(groups, 'byProductDomain', issue.productDomain, issue.key);
        addGroup(groups, 'byTaskKind', issue.taskKind, issue.key);
        addGroup(groups, 'byActionBucket', issue.actionBucket, issue.key);
        for (const theme of issue.projectThemes || []) addGroup(groups, 'byProjectTheme', theme, issue.key);
        for (const system of issue.systems || []) addGroup(groups, 'bySystem', system, issue.key);
    }

    return groups;
}

const DUPLICATE_STOPWORDS = new Set([
    'and', 'are', 'for', 'from', 'have', 'into', 'not', 'that', 'the', 'this', 'with',
    'about', 'after', 'before', 'when', 'where', 'which', 'will', 'task', 'issue',
    'story', 'need', 'needs', 'create', 'update', 'add', 'fix', 'able', 'should',
]);

function duplicateTokens(issue, sourceIssue) {
    const text = [
        issue.key,
        issue.title,
        sourceIssue?.title,
        sourceIssue?.description,
        issue.productDomain,
        issue.taskKind,
        ...(issue.systems || []),
        ...(issue.projectThemes || []),
    ].join(' ').toLowerCase();

    return new Set((text.match(/[a-z0-9][a-z0-9_-]{2,}/g) || [])
        .filter((token) => !DUPLICATE_STOPWORDS.has(token))
        .slice(0, 180));
}

function setIntersectionSize(left, right) {
    let count = 0;
    for (const item of left) {
        if (right.has(item)) count += 1;
    }
    return count;
}

function sharedValues(left = [], right = []) {
    const rightSet = new Set(right.map((value) => String(value).toLowerCase()));
    return left.filter((value) => rightSet.has(String(value).toLowerCase()));
}

function normalizeTitle(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function duplicateCandidate(left, right, sourceByKey) {
    const leftSource = sourceByKey.get(left.key);
    const rightSource = sourceByKey.get(right.key);
    const leftTokens = duplicateTokens(left, leftSource);
    const rightTokens = duplicateTokens(right, rightSource);
    const overlap = setIntersectionSize(leftTokens, rightTokens);
    const unionSize = new Set([...leftTokens, ...rightTokens]).size || 1;
    const tokenScore = overlap / unionSize;
    const commonSystems = sharedValues(left.systems, right.systems);
    const commonThemes = sharedValues(left.projectThemes, right.projectThemes);
    const titleLeft = normalizeTitle(left.title || leftSource?.title);
    const titleRight = normalizeTitle(right.title || rightSource?.title);
    const titleMatch = Boolean(titleLeft && titleRight && (titleLeft.includes(titleRight) || titleRight.includes(titleLeft)));
    const sameDomain = left.productDomain !== 'unknown' && left.productDomain === right.productDomain;
    const sameKind = left.taskKind !== 'unknown' && left.taskKind === right.taskKind;
    const strongContext = commonThemes.length > 0 && (sameDomain || sameKind);

    if (!titleMatch && tokenScore < 0.2 && !(strongContext && tokenScore >= 0.15)) return null;

    let score = tokenScore;
    if (sameDomain) score += 0.12;
    if (sameKind) score += 0.08;
    if (commonSystems.length) score += Math.min(0.18, commonSystems.length * 0.09);
    if (commonThemes.length) score += Math.min(0.16, commonThemes.length * 0.08);
    if (titleMatch) score += 0.12;

    if (score < 0.62) return null;

    const confidence = score >= 0.75 ? 'high' : score >= 0.64 ? 'medium' : 'low';
    const reasons = [
        `semantic overlap ${Math.round(tokenScore * 100)}%`,
        left.productDomain === right.productDomain && left.productDomain !== 'unknown' ? `same domain ${left.productDomain}` : '',
        left.taskKind === right.taskKind && left.taskKind !== 'unknown' ? `same kind ${left.taskKind}` : '',
        commonSystems.length ? `shared systems ${commonSystems.join(', ')}` : '',
        commonThemes.length ? `shared themes ${commonThemes.join(', ')}` : '',
    ].filter(Boolean);

    return {
        leftKey: left.key,
        rightKey: right.key,
        confidence,
        score,
        reason: reasons.join('; '),
    };
}

function duplicateConfidenceWeight(confidence) {
    return { high: 3, medium: 2, low: 1 }[confidence] || 0;
}

function mergeDuplicateGroups(rankedIssues, sourceIssues, modelGroups) {
    const issueByKey = new Map(rankedIssues.map((issue) => [issue.key, issue]));
    const sourceByKey = new Map(sourceIssues.map((issue) => [issue.key, issue]));
    const edges = [];

    for (const group of modelGroups || []) {
        const keys = [...new Set((group.issueKeys || []).filter((key) => issueByKey.has(key)))];
        if (keys.length < 2) continue;
        for (let i = 0; i < keys.length; i += 1) {
            for (let j = i + 1; j < keys.length; j += 1) {
                edges.push({
                    leftKey: keys[i],
                    rightKey: keys[j],
                    confidence: group.confidence || 'low',
                    score: duplicateConfidenceWeight(group.confidence || 'low') / 3,
                    reason: group.reason || 'Model marked these issues as overlapping within a chunk.',
                });
            }
        }
    }

    for (let i = 0; i < rankedIssues.length; i += 1) {
        for (let j = i + 1; j < rankedIssues.length; j += 1) {
            const candidate = duplicateCandidate(rankedIssues[i], rankedIssues[j], sourceByKey);
            if (candidate) edges.push(candidate);
        }
    }

    if (!edges.length) return [];

    const parent = new Map(rankedIssues.map((issue) => [issue.key, issue.key]));
    const find = (key) => {
        const root = parent.get(key);
        if (root === key) return key;
        const next = find(root);
        parent.set(key, next);
        return next;
    };
    const union = (leftKey, rightKey) => {
        const leftRoot = find(leftKey);
        const rightRoot = find(rightKey);
        if (leftRoot !== rightRoot) parent.set(rightRoot, leftRoot);
    };

    for (const edge of edges) union(edge.leftKey, edge.rightKey);

    const groupedKeys = new Map();
    for (const issue of rankedIssues) {
        const root = find(issue.key);
        if (!groupedKeys.has(root)) groupedKeys.set(root, []);
        groupedKeys.get(root).push(issue.key);
    }

    const groups = [];
    for (const keys of groupedKeys.values()) {
        if (keys.length < 2) continue;
        const groupEdges = edges.filter((edge) => keys.includes(edge.leftKey) && keys.includes(edge.rightKey));
        const bestEdge = groupEdges.sort((a, b) => b.score - a.score)[0];
        const canonical = keys
            .map((key) => issueByKey.get(key))
            .sort((a, b) => a.rank - b.rank || b.score - a.score)[0];
        const confidence = groupEdges.reduce(
            (best, edge) => duplicateConfidenceWeight(edge.confidence) > duplicateConfidenceWeight(best) ? edge.confidence : best,
            'low',
        );

        for (const key of keys) {
            if (key === canonical.key) continue;
            const issue = issueByKey.get(key);
            issue.possibleDuplicateOf = canonical.key;
            issue.duplicateConfidence = confidence;
            issue.duplicateReason = bestEdge?.reason || 'Possible duplicate found in final cross-backlog duplicate pass.';
            issue.actionBucket = 'deduplicate';
        }

        groups.push({
            groupId: `possible-duplicate-${groups.length + 1}`,
            issueKeys: keys.sort((a, b) => issueByKey.get(a).rank - issueByKey.get(b).rank),
            confidence,
            reason: bestEdge?.reason || 'Possible duplicate found in final cross-backlog duplicate pass.',
            recommendedCanonicalKey: canonical.key,
        });
    }

    return groups;
}

function buildFinalAnalysis(issues, chunkResults) {
    const issueByKey = new Map(issues.map((issue) => [issue.key, issue]));
    const rankedByKey = new Map();

    for (const issue of chunkResults.rankedIssues || []) {
        if (!issue?.key || rankedByKey.has(issue.key)) continue;
        rankedByKey.set(issue.key, issue);
    }

    for (const issue of issues) {
        if (!rankedByKey.has(issue.key)) {
            rankedByKey.set(issue.key, fallbackIssueAnalysis(issue, 'Issue was missing after chunk merge.'));
        }
    }

    const rankedIssues = [...rankedByKey.values()]
        .map((issue) => ({
            ...issue,
            title: issue.title || issueByKey.get(issue.key)?.title || issue.key,
            score: alignScoreWithImportance(normalizeModelScore(issue.score || 50), issue.importance),
        }))
        .sort((a, b) => {
            const scoreDiff = b.score - a.score;
            if (scoreDiff) return scoreDiff;
            return importanceWeight(b.importance) - importanceWeight(a.importance);
        })
        .map((issue, index) => {
            const classification = classifyIssue(issueByKey.get(issue.key) || issue);
            return {
                ...issue,
                workArea: issue.workArea && issue.workArea !== 'unknown' ? issue.workArea : classification.workArea,
                productDomain: issue.productDomain && issue.productDomain !== 'unknown' ? issue.productDomain : classification.productDomain,
                taskKind: issue.taskKind && issue.taskKind !== 'unknown' ? issue.taskKind : classification.taskKind,
                systems: issue.systems?.length ? issue.systems : classification.systems,
                projectThemes: issue.projectThemes?.length ? issue.projectThemes : classification.projectThemes,
                actionBucket: issue.actionBucket === 'deduplicate' || issue.actionBucket === 'close_candidate'
                    ? issue.actionBucket
                    : actionBucketFromScore(issue.score, classification.actionBucket),
                possibleDuplicateOf: issue.possibleDuplicateOf || null,
                duplicateConfidence: issue.duplicateConfidence || null,
                duplicateReason: issue.duplicateReason || '',
                rank: index + 1,
            };
        });

    const modelDuplicateGroups = (chunkResults.duplicateGroups || [])
        .filter((group) => Array.isArray(group.issueKeys) && group.issueKeys.length > 1)
        .map((group, index) => ({
            ...group,
            groupId: group.groupId || `duplicate-${index + 1}`,
        }));
    const duplicateGroups = mergeDuplicateGroups(rankedIssues, issues, modelDuplicateGroups);

    const highPriorityCount = rankedIssues.filter((issue) => issue.importance === 'critical' || issue.importance === 'high').length;

    return AnalysisSchema.parse({
        summary: {
            totalIssuesReviewed: issues.length,
            highPriorityCount,
            duplicateGroupCount: duplicateGroups.length,
            overallAssessment: `Reviewed ${issues.length} backlog issues in structured chunks. ${highPriorityCount} issues were classified as high or critical priority.`,
            recommendedNextStep: rankedIssues[0]
                ? `Start with ${rankedIssues[0].key}: ${rankedIssues[0].suggestedAction}`
                : 'No issues were available for analysis.',
        },
        rankedIssues,
        duplicateGroups,
        themes: chunkResults.themes || [],
        groups: buildGroups(rankedIssues),
    });
}

async function analyzeBacklog(model, exportPayload, issues, options) {
    const chunkSize = Math.max(1, Number(options['chunk-size'] || process.env.TASK_SORTER_CHUNK_SIZE || 5));
    const warnings = [];
    const chunks = chunkItems(issues, chunkSize);
    const results = [];

    for (const [index, chunk] of chunks.entries()) {
        console.error(`Analyzing chunk ${index + 1}/${chunks.length} (${chunk.length} issues)...`);
        results.push(await analyzeChunkWithSplit(model, exportPayload, chunk, warnings));
    }

    return {
        analysis: buildFinalAnalysis(issues, mergeChunkResults(results)),
        warnings,
        chunkSize,
    };
}

function toAnalysisInput(exportPayload, options) {
    const issues = options['max-analyze-issues'] ? exportPayload.issues.slice(0, Number(options['max-analyze-issues'])) : exportPayload.issues;
    const maxDescriptionChars = Number(options['max-description-chars'] || process.env.TASK_SORTER_MAX_DESCRIPTION_CHARS || 2500);
    return issues.map((issue) => ({
        key: issue.key,
        title: issue.summary,
        description: truncateText(issue.description, maxDescriptionChars),
        status: issue.status,
        statusCategory: issue.statusCategory,
        type: issue.type,
        priority: issue.priority,
        assignee: issue.assignee,
        updated: issue.updated,
        labels: issue.labels,
        components: issue.components,
        parent: issue.parent,
        sprintNames: issue.sprintNames,
        storyPoints: issue.storyPoints,
    }));
}

async function analyzeIssues(options) {
    const inputPath = resolve(options.input || DEFAULT_EXPORT_PATH);
    const outPath = resolve(options.out || DEFAULT_ANALYSIS_PATH);
    const reportPath = resolve(options.report || outPath.replace(/\.json$/i, '.md'));
    const htmlReportPath = resolve(options.html || options['html-report'] || reportPath.replace(/\.md$/i, '.html'));
    const exportPayload = JSON.parse(await readFile(inputPath, 'utf8'));
    const issues = toAnalysisInput(exportPayload, options);
    const modelName = options.model || Model.COPILOT_CLAUDE_SONNET_4_6;
    console.log(`Using model: ${modelName}`);
    const model = await chatModel(modelName, {
        apiKey: options['api-key'],
        githubToken: options['github-token'],
        ollamaUrl: options['ollama-url'],
        think: booleanOption(options.think ?? process.env.OLLAMA_THINK, false),
    });
    const result = await analyzeBacklog(model, exportPayload, issues, options);

    const payload = {
        source: exportPayload.source,
        analyzedAt: new Date().toISOString(),
        model: modelName,
        reviewedIssueCount: issues.length,
        chunkSize: result.chunkSize,
        warnings: result.warnings,
        analysis: result.analysis,
    };

    await writeJson(outPath, payload);
    await writeText(reportPath, renderMarkdownReport(payload));
    await writeText(htmlReportPath, renderHtmlReport(payload));
    return { outPath, reportPath, htmlReportPath, count: issues.length };
}

async function renderReport(options) {
    const inputPath = resolve(options.input || DEFAULT_ANALYSIS_PATH);
    const reportPath = resolve(options.report || inputPath.replace(/\.json$/i, '.md'));
    const htmlReportPath = resolve(options.html || options['html-report'] || reportPath.replace(/\.md$/i, '.html'));
    const payload = JSON.parse(await readFile(inputPath, 'utf8'));
    await writeText(reportPath, renderMarkdownReport(payload));
    await writeText(htmlReportPath, renderHtmlReport(payload));
    return { reportPath, htmlReportPath, count: payload.reviewedIssueCount || payload.analysis?.summary?.totalIssuesReviewed || 0 };
}

async function writeJson(filePath, payload) {
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

async function writeText(filePath, text) {
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, text, 'utf8');
}

function markdownEscape(value) {
    return String(value ?? '')
        .replace(/\|/g, '\\|')
        .replace(/\n+/g, ' ')
        .trim();
}

function htmlEscape(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function issueLink(source, key) {
    return source?.jiraBaseUrl ? `[${key}](${source.jiraBaseUrl}/browse/${key})` : key;
}

function issueHtmlLink(source, key) {
    const label = htmlEscape(key);
    return source?.jiraBaseUrl
        ? `<a href="${htmlEscape(`${source.jiraBaseUrl}/browse/${key}`)}" target="_blank" rel="noreferrer">${label}</a>`
        : label;
}

function badge(value) {
    const safe = htmlEscape(value || 'unknown');
    return `<span class="badge badge-${safe.replace(/[^a-z0-9_-]/gi, '-')}">${safe}</span>`;
}

function renderMarkdownReport(payload) {
    const { source, analysis } = payload;
    const lines = [
        '# QIN Backlog Analysis',
        '',
        `- Analyzed at: ${payload.analyzedAt}`,
        `- Model: ${payload.model}`,
        `- Reviewed issues: ${payload.reviewedIssueCount}`,
        `- Chunk size: ${payload.chunkSize || 'n/a'}`,
        `- JQL: \`${source?.jql || ''}\``,
        '',
        '## Summary',
        '',
        analysis.summary?.overallAssessment || 'No summary provided.',
        '',
        `Recommended next step: ${analysis.summary?.recommendedNextStep || 'No recommendation provided.'}`,
        '',
        '## Duplicate Candidates',
        '',
    ];

    appendDuplicateCandidateSection(lines, analysis.duplicateGroups, source);

    lines.push(
        '',
        '## Ranked Issues',
        '',
        '| Rank | Issue | Importance | Score | Area | Domain | Kind | Action | Duplicate | Title |',
        '| ---: | --- | --- | ---: | --- | --- | --- | --- | --- | --- |',
    );

    for (const issue of analysis.rankedIssues || []) {
        const duplicateMarker = issue.duplicateOf
            ? `duplicate of ${issue.duplicateOf}`
            : issue.possibleDuplicateOf
                ? `possible of ${issue.possibleDuplicateOf} (${issue.duplicateConfidence || 'low'})`
                : '';
        lines.push([
            issue.rank,
            issueLink(source, issue.key),
            issue.importance,
            issue.score,
            issue.workArea,
            issue.productDomain,
            issue.taskKind,
            issue.actionBucket,
            markdownEscape(duplicateMarker),
            markdownEscape(issue.title),
        ].join(' | '));
    }

    lines.push('', '## Groups', '');
    appendGroupSection(lines, 'By Work Area', analysis.groups?.byWorkArea, source);
    appendGroupSection(lines, 'By Product Domain', analysis.groups?.byProductDomain, source);
    appendGroupSection(lines, 'By Task Kind', analysis.groups?.byTaskKind, source);
    appendGroupSection(lines, 'By Action Bucket', analysis.groups?.byActionBucket, source);
    appendGroupSection(lines, 'By Project Theme', analysis.groups?.byProjectTheme, source);
    appendGroupSection(lines, 'By System', analysis.groups?.bySystem, source);

    lines.push('', '## Duplicates Detail', '');
    if (analysis.duplicateGroups?.length) {
        for (const group of analysis.duplicateGroups) {
            lines.push(`- ${group.groupId}: ${group.issueKeys.map((key) => issueLink(source, key)).join(', ')} (${group.confidence}); canonical: ${issueLink(source, group.recommendedCanonicalKey)}`);
            lines.push(`  ${group.reason}`);
        }
    } else {
        lines.push('No duplicate groups detected.');
    }

    if (payload.warnings?.length) {
        lines.push('', '## Warnings', '');
        for (const warning of payload.warnings) {
            lines.push(`- ${markdownEscape(warning)}`);
        }
    }

    lines.push('', '## Themes', '');
    if (analysis.themes?.length) {
        lines.push('| Theme | Importance | Issues | Notes |');
        lines.push('| --- | --- | --- | --- |');
        for (const theme of analysis.themes) {
            lines.push([
                markdownEscape(theme.name),
                theme.importance,
                (theme.issueKeys || []).map((key) => issueLink(source, key)).join(', '),
                markdownEscape(theme.notes),
            ].join(' | '));
        }
    } else {
        lines.push('No themes returned by the model.');
    }

    lines.push('', '## Detailed Reasoning', '');
    for (const issue of analysis.rankedIssues || []) {
        lines.push(`### ${issue.rank}. ${issue.key} - ${issue.title}`);
        lines.push('');
        lines.push(`Importance: ${issue.importance}; confidence: ${issue.confidence}; score: ${issue.score}`);
        lines.push(`Area: ${issue.workArea}; domain: ${issue.productDomain}; kind: ${issue.taskKind}; action: ${issue.actionBucket}`);
        if (issue.systems?.length) lines.push(`Systems: ${issue.systems.join(', ')}`);
        if (issue.projectThemes?.length) lines.push(`Project themes: ${issue.projectThemes.join(', ')}`);
        if (issue.possibleDuplicateOf) {
            lines.push(`Possible duplicate of: ${issue.possibleDuplicateOf} (${issue.duplicateConfidence || 'low'}). ${issue.duplicateReason || ''}`);
        }
        lines.push('');
        lines.push(issue.reasoning || 'No reasoning provided.');
        lines.push('');
    }

    return `${lines.join('\n')}\n`;
}

function renderHtmlReport(payload) {
    const { source, analysis } = payload;
    const duplicateRows = renderDuplicateCandidateRows(analysis.duplicateGroups, source);
    const rankedRows = (analysis.rankedIssues || []).map((issue) => {
        const duplicateMarker = issue.duplicateOf
            ? `duplicate of ${issue.duplicateOf}`
            : issue.possibleDuplicateOf
                ? `possible of ${issue.possibleDuplicateOf} (${issue.duplicateConfidence || 'low'})`
                : '';

        return `<tr>
            <td class="num">${issue.rank}</td>
            <td>${issueHtmlLink(source, issue.key)}</td>
            <td>${badge(issue.importance)}</td>
            <td class="num">${htmlEscape(issue.score)}</td>
            <td>${badge(issue.workArea)}</td>
            <td>${badge(issue.productDomain)}</td>
            <td>${badge(issue.taskKind)}</td>
            <td>${badge(issue.actionBucket)}</td>
            <td>${htmlEscape(duplicateMarker)}</td>
            <td>${htmlEscape(issue.title)}</td>
        </tr>`;
    }).join('\n');

    const duplicateDetails = analysis.duplicateGroups?.length
        ? analysis.duplicateGroups.map((group) => `<li>
            <strong>${htmlEscape(group.groupId)}</strong>:
            ${(group.issueKeys || []).map((key) => issueHtmlLink(source, key)).join(', ')}
            <span class="muted">(${htmlEscape(group.confidence)}); canonical: ${issueHtmlLink(source, group.recommendedCanonicalKey)}</span>
            <div class="reason">${htmlEscape(group.reason)}</div>
        </li>`).join('\n')
        : '<p class="muted">No duplicate groups detected.</p>';

    const warnings = payload.warnings?.length
        ? `<section><h2>Warnings</h2><ul>${payload.warnings.map((warning) => `<li>${htmlEscape(warning)}</li>`).join('\n')}</ul></section>`
        : '';

    const themeRows = analysis.themes?.length
        ? (analysis.themes || []).map((theme) => `<tr>
            <td>${htmlEscape(theme.name)}</td>
            <td>${badge(theme.importance)}</td>
            <td>${(theme.issueKeys || []).map((key) => issueHtmlLink(source, key)).join(', ')}</td>
            <td>${htmlEscape(theme.notes)}</td>
        </tr>`).join('\n')
        : '<tr><td colspan="4" class="muted">No themes returned by the model.</td></tr>';

    const reasoning = (analysis.rankedIssues || []).map((issue) => `<details>
        <summary>${htmlEscape(`${issue.rank}. ${issue.key} - ${issue.title}`)}</summary>
        <p><strong>Importance:</strong> ${htmlEscape(issue.importance)}; <strong>confidence:</strong> ${htmlEscape(issue.confidence)}; <strong>score:</strong> ${htmlEscape(issue.score)}</p>
        <p><strong>Area:</strong> ${htmlEscape(issue.workArea)}; <strong>domain:</strong> ${htmlEscape(issue.productDomain)}; <strong>kind:</strong> ${htmlEscape(issue.taskKind)}; <strong>action:</strong> ${htmlEscape(issue.actionBucket)}</p>
        ${issue.systems?.length ? `<p><strong>Systems:</strong> ${htmlEscape(issue.systems.join(', '))}</p>` : ''}
        ${issue.projectThemes?.length ? `<p><strong>Project themes:</strong> ${htmlEscape(issue.projectThemes.join(', '))}</p>` : ''}
        ${issue.possibleDuplicateOf ? `<p><strong>Possible duplicate of:</strong> ${issueHtmlLink(source, issue.possibleDuplicateOf)} (${htmlEscape(issue.duplicateConfidence || 'low')}). ${htmlEscape(issue.duplicateReason || '')}</p>` : ''}
        <p>${htmlEscape(issue.reasoning || 'No reasoning provided.')}</p>
    </details>`).join('\n');

    return `<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>QIN Backlog Analysis</title>
    <style>
        :root { color-scheme: light dark; --bg: #f6f7f9; --panel: #ffffff; --text: #1f2933; --muted: #667085; --line: #d7dce2; --link: #1b63a7; }
        @media (prefers-color-scheme: dark) { :root { --bg: #181b20; --panel: #22262d; --text: #e8ecf1; --muted: #a7b0bd; --line: #3a4049; --link: #8ab4f8; } }
        body { margin: 0; background: var(--bg); color: var(--text); font: 14px/1.45 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
        main { max-width: 1480px; margin: 0 auto; padding: 24px; }
        h1 { font-size: 28px; margin: 0 0 16px; }
        h2 { margin: 28px 0 12px; font-size: 20px; }
        h3 { margin: 20px 0 8px; font-size: 16px; }
        section { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 16px; margin: 16px 0; }
        a { color: var(--link); text-decoration: none; }
        a:hover { text-decoration: underline; }
        .meta { display: flex; flex-wrap: wrap; gap: 8px 16px; color: var(--muted); margin-bottom: 16px; }
        .table-wrap { overflow-x: auto; border: 1px solid var(--line); border-radius: 8px; }
        table { width: 100%; border-collapse: collapse; background: var(--panel); }
        th, td { border-bottom: 1px solid var(--line); padding: 8px 10px; text-align: left; vertical-align: top; }
        th { position: sticky; top: 0; background: var(--panel); z-index: 1; white-space: nowrap; }
        tr:hover td { background: color-mix(in srgb, var(--line) 18%, transparent); }
        .num { text-align: right; font-variant-numeric: tabular-nums; }
        .badge { display: inline-block; border: 1px solid var(--line); border-radius: 999px; padding: 2px 8px; white-space: nowrap; }
        .badge-critical, .badge-do_now { border-color: #b42318; color: #b42318; }
        .badge-high, .badge-schedule_next { border-color: #b54708; color: #b54708; }
        .badge-deduplicate { border-color: #6941c6; color: #6941c6; }
        .muted, .reason { color: var(--muted); }
        details { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 10px 12px; margin: 8px 0; }
        summary { cursor: pointer; font-weight: 600; }
    </style>
</head>
<body>
<main>
    <h1>QIN Backlog Analysis</h1>
    <div class="meta">
        <span>Analyzed at: ${htmlEscape(payload.analyzedAt)}</span>
        <span>Model: ${htmlEscape(payload.model)}</span>
        <span>Reviewed issues: ${htmlEscape(payload.reviewedIssueCount)}</span>
        <span>Chunk size: ${htmlEscape(payload.chunkSize || 'n/a')}</span>
        <span>JQL: ${htmlEscape(source?.jql || '')}</span>
    </div>

    <section>
        <h2>Summary</h2>
        <p>${htmlEscape(analysis.summary?.overallAssessment || 'No summary provided.')}</p>
        <p><strong>Recommended next step:</strong> ${htmlEscape(analysis.summary?.recommendedNextStep || 'No recommendation provided.')}</p>
    </section>

    <section>
        <h2>Duplicate Candidates</h2>
        <div class="table-wrap"><table>
            <thead><tr><th>Group</th><th>Confidence</th><th>Canonical</th><th>Candidates</th><th>Reason</th></tr></thead>
            <tbody>${duplicateRows}</tbody>
        </table></div>
    </section>

    <section>
        <h2>Ranked Issues</h2>
        <div class="table-wrap"><table>
            <thead><tr><th>Rank</th><th>Issue</th><th>Importance</th><th>Score</th><th>Area</th><th>Domain</th><th>Kind</th><th>Action</th><th>Duplicate</th><th>Title</th></tr></thead>
            <tbody>${rankedRows}</tbody>
        </table></div>
    </section>

    <section>
        <h2>Duplicates Detail</h2>
        <ul>${duplicateDetails}</ul>
    </section>

    ${warnings}

    <section>
        <h2>Themes</h2>
        <div class="table-wrap"><table>
            <thead><tr><th>Theme</th><th>Importance</th><th>Issues</th><th>Notes</th></tr></thead>
            <tbody>${themeRows}</tbody>
        </table></div>
    </section>

    <section>
        <h2>Detailed Reasoning</h2>
        ${reasoning}
    </section>
</main>
</body>
</html>
`;
}

function renderDuplicateCandidateRows(duplicateGroups, source) {
    if (!duplicateGroups?.length) {
        return '<tr><td colspan="5" class="muted">No duplicate candidates detected.</td></tr>';
    }

    return duplicateGroups.map((group) => {
        const candidates = (group.issueKeys || [])
            .filter((key) => key !== group.recommendedCanonicalKey)
            .map((key) => issueHtmlLink(source, key))
            .join(', ');

        return `<tr>
            <td>${htmlEscape(group.groupId)}</td>
            <td>${badge(group.confidence)}</td>
            <td>${issueHtmlLink(source, group.recommendedCanonicalKey)}</td>
            <td>${candidates || '<span class="muted">(none)</span>'}</td>
            <td>${htmlEscape(group.reason)}</td>
        </tr>`;
    }).join('\n');
}

function appendDuplicateCandidateSection(lines, duplicateGroups, source) {
    if (!duplicateGroups?.length) {
        lines.push('No duplicate candidates detected.');
        return;
    }

    lines.push('| Group | Confidence | Canonical | Candidates | Reason |');
    lines.push('| --- | --- | --- | --- | --- |');

    for (const group of duplicateGroups) {
        const candidates = (group.issueKeys || [])
            .filter((key) => key !== group.recommendedCanonicalKey)
            .map((key) => issueLink(source, key))
            .join(', ');

        lines.push([
            markdownEscape(group.groupId),
            group.confidence,
            issueLink(source, group.recommendedCanonicalKey),
            candidates || '(none)',
            markdownEscape(group.reason),
        ].join(' | '));
    }
}

function appendGroupSection(lines, title, groups, source) {
    const entries = Object.entries(groups || {})
        .filter(([, issueKeys]) => Array.isArray(issueKeys) && issueKeys.length)
        .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));

    if (!entries.length) return;

    lines.push(`### ${title}`, '');
    for (const [name, issueKeys] of entries) {
        lines.push(`- ${markdownEscape(name)}: ${issueKeys.map((key) => issueLink(source, key)).join(', ')}`);
    }
    lines.push('');
}

function printHelp() {
    console.log(`Usage:
  bun ./scripts/task-sorter.ts export [--jql <jql>] [--out <file>]
  bun ./scripts/task-sorter.ts analyze [--input <file>] [--out <file>] [--model <model>] [--report <file.md>] [--html <file.html>]
  bun ./scripts/task-sorter.ts render [--input <analysis.json>] [--report <file.md>] [--html <file.html>]
  bun ./scripts/task-sorter.ts run [options]

Defaults:
  JQL: ${DEFAULT_JQL}
  Export: ${DEFAULT_EXPORT_PATH}
  Analysis: ${DEFAULT_ANALYSIS_PATH}
  Report: ${DEFAULT_REPORT_PATH}
  HTML report: ${DEFAULT_HTML_REPORT_PATH}
  Model: ${Model.COPILOT_CLAUDE_SONNET_4_6}
  Chunk size: 5 issues; override with --chunk-size
  Ollama thinking: disabled by default for structured output; pass --think true to enable
  Analysis description limit: 2500 chars per issue; override with --max-description-chars
`);
}

const args = parseArgs(process.argv.slice(2));
const command = args._[0] || 'run';

try {
    if (args.help || args.h) {
        printHelp();
    } else if (command === 'export') {
        const result = await exportIssues(args);
        console.log(`Exported ${result.count} issues to ${result.outPath}`);
    } else if (command === 'analyze') {
        const result = await analyzeIssues(args);
        console.log(`Analyzed ${result.count} issues to ${result.outPath}`);
        console.log(`Report written to ${result.reportPath}`);
        console.log(`HTML report written to ${result.htmlReportPath}`);
    } else if (command === 'render') {
        const result = await renderReport(args);
        console.log(`Rendered report for ${result.count} issues to ${result.reportPath}`);
        console.log(`Rendered HTML report to ${result.htmlReportPath}`);
    } else if (command === 'run') {
        const exportResult = await exportIssues({ ...args, out: args.exportOut || args.export || DEFAULT_EXPORT_PATH });
        const analyzeResult = await analyzeIssues({ ...args, input: exportResult.outPath, out: args.out || DEFAULT_ANALYSIS_PATH });
        console.log(`Exported ${exportResult.count} issues to ${exportResult.outPath}`);
        console.log(`Analyzed ${analyzeResult.count} issues to ${analyzeResult.outPath}`);
        console.log(`Report written to ${analyzeResult.reportPath}`);
        console.log(`HTML report written to ${analyzeResult.htmlReportPath}`);
    } else {
        printHelp();
        process.exitCode = 1;
    }
} catch (err) {
    console.error(`ERROR: ${err.message}`);
    process.exit(1);
}
