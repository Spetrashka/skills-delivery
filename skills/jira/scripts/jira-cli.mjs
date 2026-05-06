#!/usr/bin/env node
/**
 * Jira CLI — thin wrapper around the Jira REST API v3.
 * Used by the jira Copilot skill via run_in_terminal.
 *
 * Usage:
 *   node jira-cli.mjs --tool <tool_name> --args '<json>'
 *
 * Example:
 *   node jira-cli.mjs --tool get_issue --args '{"issueKey":"QIN-123"}'
 */

import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.env.HOME, '.config/jira-mcp/.env') });

const JIRA_BASE_URL = process.env.JIRA_BASE_URL?.replace(/\/$/, '');
const JIRA_EMAIL = process.env.JIRA_EMAIL;
const JIRA_API_TOKEN = process.env.JIRA_API_TOKEN;

if (!JIRA_BASE_URL || !JIRA_EMAIL || !JIRA_API_TOKEN) {
    console.error('ERROR: Missing JIRA_BASE_URL, JIRA_EMAIL, or JIRA_API_TOKEN in ~/.config/jira-mcp/.env');
    process.exit(1);
}

const AUTH_HEADER = 'Basic ' + Buffer.from(`${JIRA_EMAIL}:${JIRA_API_TOKEN}`).toString('base64');

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2);
const toolIdx = argv.indexOf('--tool');
const argsIdx = argv.indexOf('--args');

if (toolIdx === -1) {
    console.error('Usage: node jira-cli.mjs --tool <name> [--args <json>]');
    console.error('\nAvailable tools:');
    console.error('  search_issues    --args {"jql":"project=QIN ORDER BY created DESC","maxResults":20}');
    console.error('  get_issue        --args {"issueKey":"QIN-123"}');
    console.error('  create_issue     --args {"projectKey","summary","issueType","description","priority","labels"}');
    console.error('  update_issue     --args {"issueKey","summary","description","assigneeAccountId","priority","labels"}');
    console.error('  transition_issue --args {"issueKey","transitionName"}   (omit transitionName to list available)');
    console.error('  delete_issue     --args {"issueKey","deleteSubtasks":false}');
    console.error('  add_comment      --args {"issueKey","body"}');
    console.error('  get_comments     --args {"issueKey"}');
    console.error('  list_projects    --args {}');
    console.error('  assign_issue     --args {"issueKey","accountId"}');
    console.error('  search_users     --args {"query":"name or email","maxResults":10}');
    process.exit(1);
}

const toolName = argv[toolIdx + 1];
const rawArgs = argsIdx !== -1 ? argv[argsIdx + 1] : '{}';
let toolArgs;
try {
    toolArgs = JSON.parse(rawArgs);
} catch {
    console.error(`ERROR: --args is not valid JSON: ${rawArgs}`);
    process.exit(1);
}

// ---------------------------------------------------------------------------
// Jira API helpers
// ---------------------------------------------------------------------------

async function jiraFetch(path, options = {}) {
    const url = `${JIRA_BASE_URL}/rest/api/3${path}`;
    const res = await fetch(url, {
        ...options,
        headers: {
            Authorization: AUTH_HEADER,
            'Content-Type': 'application/json',
            Accept: 'application/json',
            ...options.headers,
        },
    });
    if (!res.ok) {
        const body = await res.text();
        throw new Error(`Jira API ${res.status}: ${body}`);
    }
    if (res.status === 204) return null;
    return res.json();
}

function textToAdf(text) {
    if (!text) return undefined;
    const content = [];
    for (const line of text.split('\n')) {
        if (line.trim() === '') {
            if (content.length > 0 && content[content.length - 1].type !== 'paragraph' || content[content.length - 1]?.content?.length > 0) {
                content.push({ type: 'paragraph', content: [] });
            }
        } else {
            content.push({ type: 'paragraph', content: [{ type: 'text', text: line }] });
        }
    }
    // Remove trailing empty paragraphs
    while (content.length > 0 && content[content.length - 1].content?.length === 0) {
        content.pop();
    }
    return { version: 1, type: 'doc', content };
}

function adfToText(adf) {
    if (!adf || !adf.content) return '';
    return adf.content
        .map(block => {
            if (!block.content) return '';
            return block.content.map(n => n.text || '').join('');
        })
        .join('\n');
}

function formatIssue(issue) {
    const f = issue.fields || {};
    const lines = [
        `Key:         ${issue.key}`,
        `Summary:     ${f.summary || '—'}`,
        `Status:      ${f.status?.name || '—'}`,
        `Type:        ${f.issuetype?.name || '—'}`,
        `Priority:    ${f.priority?.name || '—'}`,
        `Assignee:    ${f.assignee?.displayName || 'Unassigned'}`,
        `Reporter:    ${f.reporter?.displayName || '—'}`,
        `Created:     ${f.created || '—'}`,
        `Updated:     ${f.updated || '—'}`,
    ];
    if (f.description) lines.push(`\nDescription:\n${adfToText(f.description)}`);
    if (f.labels?.length) lines.push(`Labels:      ${f.labels.join(', ')}`);
    if (f.components?.length) lines.push(`Components:  ${f.components.map(c => c.name).join(', ')}`);
    return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Tool implementations
// ---------------------------------------------------------------------------

const tools = {
    async search_issues({ jql, maxResults = 20 }) {
        const data = await jiraFetch('/search/jql', {
            method: 'POST',
            body: JSON.stringify({
                jql,
                maxResults,
                fields: [
                    'summary',
                    'status',
                    'issuetype',
                    'priority',
                    'assignee',
                    'reporter',
                    'created',
                    'updated',
                    'labels',
                    'components',
                    'description',
                ],
            }),
        });
        return data.issues.map(formatIssue).join('\n\n---\n\n') || 'No issues found.';
    },

    async get_issue({ issueKey }) {
        const issue = await jiraFetch(`/issue/${encodeURIComponent(issueKey)}`);
        return formatIssue(issue);
    },

    async create_issue({ projectKey, summary, issueType = 'Task', description, assigneeAccountId, priority, labels, parentKey, dueDate }) {
        const fields = {
            project: { key: projectKey },
            summary,
            issuetype: { name: issueType },
        };
        if (description) fields.description = textToAdf(description);
        if (assigneeAccountId) fields.assignee = { accountId: assigneeAccountId };
        if (priority) fields.priority = { name: priority };
        if (labels) fields.labels = labels;
        if (parentKey) fields.parent = { key: parentKey };
        if (dueDate) fields.duedate = dueDate;

        const result = await jiraFetch('/issue', {
            method: 'POST',
            body: JSON.stringify({ fields }),
        });
        return `Created issue ${result.key}\nURL: ${JIRA_BASE_URL}/browse/${result.key}`;
    },

    async update_issue({ issueKey, summary, description, assigneeAccountId, priority, labels }) {
        const fields = {};
        if (summary !== undefined) fields.summary = summary;
        if (description !== undefined) fields.description = textToAdf(description);
        if (assigneeAccountId !== undefined) fields.assignee = assigneeAccountId ? { accountId: assigneeAccountId } : null;
        if (priority !== undefined) fields.priority = { name: priority };
        if (labels !== undefined) fields.labels = labels;

        await jiraFetch(`/issue/${encodeURIComponent(issueKey)}`, {
            method: 'PUT',
            body: JSON.stringify({ fields }),
        });
        return `Updated issue ${issueKey}`;
    },

    async transition_issue({ issueKey, transitionName, transitionId }) {
        if (!transitionName && !transitionId) {
            const data = await jiraFetch(`/issue/${encodeURIComponent(issueKey)}/transitions`);
            return (
                `Available transitions for ${issueKey}:\n` +
                data.transitions.map(t => `  ${t.id}: ${t.name} → ${t.to?.name || '?'}`).join('\n')
            );
        }
        let tid = transitionId;
        if (!tid && transitionName) {
            const data = await jiraFetch(`/issue/${encodeURIComponent(issueKey)}/transitions`);
            const match = data.transitions.find(
                t => t.name.toLowerCase() === transitionName.toLowerCase() || t.to?.name?.toLowerCase() === transitionName.toLowerCase()
            );
            if (!match) {
                const available = data.transitions.map(t => `${t.name} (→ ${t.to?.name})`).join(', ');
                return `Transition "${transitionName}" not found. Available: ${available}`;
            }
            tid = match.id;
        }
        await jiraFetch(`/issue/${encodeURIComponent(issueKey)}/transitions`, {
            method: 'POST',
            body: JSON.stringify({ transition: { id: tid } }),
        });
        return `Transitioned ${issueKey} successfully`;
    },

    async delete_issue({ issueKey, deleteSubtasks = false }) {
        await jiraFetch(`/issue/${encodeURIComponent(issueKey)}?deleteSubtasks=${deleteSubtasks}`, { method: 'DELETE' });
        return `Deleted issue ${issueKey}`;
    },

    async add_comment({ issueKey, body }) {
        await jiraFetch(`/issue/${encodeURIComponent(issueKey)}/comment`, {
            method: 'POST',
            body: JSON.stringify({ body: textToAdf(body) }),
        });
        return `Comment added to ${issueKey}`;
    },

    async get_comments({ issueKey }) {
        const data = await jiraFetch(`/issue/${encodeURIComponent(issueKey)}/comment`);
        if (!data.comments?.length) return `No comments on ${issueKey}`;
        return data.comments.map(c => `[${c.created}] ${c.author?.displayName || '?'}:\n${adfToText(c.body)}`).join('\n\n---\n\n');
    },

    async list_projects() {
        const data = await jiraFetch('/project?expand=description');
        return data.map(p => `${p.key}  —  ${p.name}`).join('\n') || 'No projects found.';
    },

    async assign_issue({ issueKey, accountId }) {
        await jiraFetch(`/issue/${encodeURIComponent(issueKey)}/assignee`, {
            method: 'PUT',
            body: JSON.stringify({ accountId: accountId || null }),
        });
        return `Assigned ${issueKey} to ${accountId || 'nobody'}`;
    },

    async search_users({ query, maxResults = 10 }) {
        const data = await jiraFetch(`/user/search?query=${encodeURIComponent(query)}&maxResults=${maxResults}`);
        if (!data?.length) return 'No users found.';
        return data.map(u => `${u.displayName} — accountId: ${u.accountId} — email: ${u.emailAddress || '—'}`).join('\n');
    },
};

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

if (!tools[toolName]) {
    console.error(`ERROR: Unknown tool "${toolName}". Run without --tool to see available tools.`);
    process.exit(1);
}

try {
    const result = await tools[toolName](toolArgs);
    console.log(result ?? '(done)');
} catch (err) {
    console.error(`ERROR: ${err.message}`);
    process.exit(1);
}
