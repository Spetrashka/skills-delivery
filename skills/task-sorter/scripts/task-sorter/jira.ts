import { DEFAULT_JQL, DEFAULT_EXPORT_PATH, FIELDS } from './constants.ts';
import { writeJson } from './io.ts';
import { resolve } from 'node:path';

function extractProjectKey(jql) {
    const m = String(jql || '').match(/\bproject\s*=\s*"?([A-Z][A-Z0-9_-]*)"?/i);
    return m ? m[1].toUpperCase() : undefined;
}

function requireJiraConfig() {
    const baseUrl = process.env.JIRA_BASE_URL?.replace(/\/$/, '');
    const email = process.env.JIRA_EMAIL;
    const token = process.env.JIRA_API_TOKEN;
    if (!baseUrl || !email || !token) {
        throw new Error('Missing JIRA_BASE_URL, JIRA_EMAIL, or JIRA_API_TOKEN in ~/.config/jira-mcp/.env');
    }
    return { baseUrl, authHeader: `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}` };
}

async function jiraFetch(path, options = {}) {
    const { baseUrl, authHeader } = requireJiraConfig();
    const res = await fetch(`${baseUrl}/rest/api/3${path}`, {
        ...options,
        headers: { Authorization: authHeader, Accept: 'application/json', 'Content-Type': 'application/json', ...options.headers },
    });
    if (!res.ok) throw new Error(`Jira API ${res.status}: ${await res.text()}`);
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

export async function exportIssues(options) {
    const { baseUrl } = requireJiraConfig();
    const project = (options.project || process.env.TASK_SORTER_PROJECT || '').toUpperCase() || undefined;
    const jql = options.jql || (project ? `project=${project} AND statusCategory != Done ORDER BY Rank ASC` : DEFAULT_JQL);
    const pageSize = Number(options['page-size'] || 100);
    const maxIssues = options['max-issues'] ? Number(options['max-issues']) : Infinity;
    const outPath = resolve(options.out || DEFAULT_EXPORT_PATH);
    const issues = [];
    let nextPageToken;
    let isLast = false;

    while (!isLast && issues.length < maxIssues) {
        const data = await jiraFetch('/search/jql', {
            method: 'POST',
            body: JSON.stringify({ jql, maxResults: Math.min(pageSize, maxIssues - issues.length), nextPageToken, fields: FIELDS }),
        });
        for (const issue of data.issues || []) {
            issues.push(normalizeIssue(issue, baseUrl));
            if (issues.length >= maxIssues) break;
        }
        nextPageToken = data.nextPageToken;
        isLast = data.isLast === true || !nextPageToken || !data.issues?.length;
    }

    const payload = {
        source: { jiraBaseUrl: baseUrl, jql, projectKey: project || extractProjectKey(jql), exportedAt: new Date().toISOString(), readOnly: true },
        count: issues.length,
        issues,
    };
    await writeJson(outPath, payload);
    return { outPath, count: issues.length };
}
