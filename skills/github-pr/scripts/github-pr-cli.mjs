#!/usr/bin/env node
/**
 * GitHub PR CLI — thin wrapper around the GitHub REST API.
 * Used by the github-pr Copilot skill via run_in_terminal.
 *
 * Usage:
 *   node github-pr-cli.mjs --tool <tool_name> --args '<json>'
 *
 * Example:
 *   node github-pr-cli.mjs --tool get_pr --args '{"owner":"quext","repo":"quext-spa","pr":42}'
 */

import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.env.HOME, '.config/github-mcp/.env') });

const TOKEN = process.env.GITHUB_TOKEN || process.env.GITHUB_PACKAGES_TOKEN;
if (!TOKEN) {
    console.error('ERROR: Missing GITHUB_TOKEN in ~/.config/github-mcp/.env');
    process.exit(1);
}

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2);
const toolIdx = argv.indexOf('--tool');
const argsIdx = argv.indexOf('--args');

if (toolIdx === -1) {
    console.error('Usage: node github-pr-cli.mjs --tool <name> [--args <json>]');
    console.error('\nAvailable tools:');
    console.error('  list_prs             --args {"owner","repo","state","perPage"}');
    console.error('  get_pr               --args {"owner","repo","pr"}');
    console.error('  list_pr_comments     --args {"owner","repo","pr"}');
    console.error('  get_pr_comment       --args {"owner","repo","commentId"}');
    console.error('  edit_pr_comment      --args {"owner","repo","commentId","body"}');
    console.error('  delete_pr_comment    --args {"owner","repo","commentId"}');
    console.error('  list_pr_reviews      --args {"owner","repo","pr"}');
    console.error('  edit_pr_review       --args {"owner","repo","pr","reviewId","body"}');
    console.error('  list_issue_comments  --args {"owner","repo","issue"}');
    console.error('  add_issue_comment    --args {"owner","repo","issue","body"}');
    console.error('  edit_issue_comment   --args {"owner","repo","commentId","body"}');
    console.error('  delete_issue_comment --args {"owner","repo","commentId"}');
    console.error('  create_pr            --args {"owner","repo","title","head","base","body","draft"}');
    console.error('  create_review        --args {"owner","repo","pr","event","body"}');
    console.error('  audit_pr_comments    --args {"owner","repo","pr"}');
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
// GitHub API helpers
// ---------------------------------------------------------------------------

const API_BASE = 'https://api.github.com';

async function ghFetch(path, options = {}) {
    const url = path.startsWith('http') ? path : `${API_BASE}${path}`;
    const res = await fetch(url, {
        ...options,
        headers: {
            Authorization: `token ${TOKEN}`,
            Accept: 'application/vnd.github.v3+json',
            'User-Agent': 'github-pr-cli',
            ...options.headers,
        },
    });
    if (!res.ok) {
        const body = await res.text();
        throw new Error(`GitHub API ${res.status}: ${body.slice(0, 500)}`);
    }
    if (res.status === 204) return null;
    return res.json();
}

async function ghFetchAll(path, { maxPages = 20 } = {}) {
    const results = [];
    let url = `${API_BASE}${path}${path.includes('?') ? '&' : '?'}per_page=100`;
    let page = 0;
    while (url && page < maxPages) {
        const res = await fetch(url, {
            headers: {
                Authorization: `token ${TOKEN}`,
                Accept: 'application/vnd.github.v3+json',
                'User-Agent': 'github-pr-cli',
            },
        });
        if (!res.ok) {
            const body = await res.text();
            throw new Error(`GitHub API ${res.status}: ${body.slice(0, 500)}`);
        }
        const data = await res.json();
        results.push(...data);
        const linkHeader = res.headers.get('link') || '';
        const nextMatch = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
        url = nextMatch ? nextMatch[1] : null;
        page++;
    }
    return results;
}

function normalizeMarkdown(text) {
    if (!text) return text;
    return text.replace(/\\n/g, '\n').replace(/\n{4,}/g, '\n\n\n');
}

function formatComment(c) {
    const lines = [`ID: ${c.id}`, `Author: ${c.user?.login || '?'}`, `Created: ${c.created_at}`, `Updated: ${c.updated_at}`];
    if (c.path) lines.push(`File: ${c.path}:${c.line || c.original_line || '?'}`);
    if (c.html_url) lines.push(`URL: ${c.html_url}`);
    lines.push(`\n${c.body}`);
    return lines.join('\n');
}

function formatReview(r) {
    return [
        `ID: ${r.id}`,
        `State: ${r.state}`,
        `Author: ${r.user?.login || '?'}`,
        `Submitted: ${r.submitted_at || '—'}`,
        `URL: ${r.html_url || '—'}`,
        `\n${r.body || '(empty body)'}`,
    ].join('\n');
}

function formatPr(p) {
    const draft = p.draft ? ' [DRAFT]' : '';
    const reviewers = p.requested_reviewers?.map(r => r.login).join(', ') || '—';
    return [
        `PR #${p.number}${draft}: ${p.title}`,
        `Author:    ${p.user?.login || '?'}`,
        `Branch:    ${p.head?.ref} → ${p.base?.ref}`,
        `Reviewers: ${reviewers}`,
        `Updated:   ${p.updated_at}`,
        `URL:       ${p.html_url}`,
    ].join('\n');
}

// ---------------------------------------------------------------------------
// Tool implementations
// ---------------------------------------------------------------------------

const tools = {
    async list_prs({ owner, repo, state = 'open', perPage = 50 }) {
        const prs = await ghFetch(`/repos/${owner}/${repo}/pulls?state=${state}&per_page=${perPage}&sort=updated&direction=desc`);
        if (!prs.length) return 'No pull requests found.';
        return prs.map(formatPr).join('\n\n---\n\n');
    },

    async get_pr({ owner, repo, pr }) {
        const data = await ghFetch(`/repos/${owner}/${repo}/pulls/${pr}`);
        return [
            `PR \#${data.number}: ${data.title}`,
            `State:  ${data.state}`,
            `Author: ${data.user?.login}`,
            `Branch: ${data.head?.ref} → ${data.base?.ref}`,
            `URL:    ${data.html_url}`,
            `\n${data.body || '(no description)'}`,
        ].join('\n');
    },

    async list_pr_comments({ owner, repo, pr }) {
        const comments = await ghFetchAll(`/repos/${owner}/${repo}/pulls/${pr}/comments`);
        if (!comments.length) return 'No inline review comments found.';
        return comments.map(formatComment).join('\n\n---\n\n');
    },

    async get_pr_comment({ owner, repo, commentId }) {
        const c = await ghFetch(`/repos/${owner}/${repo}/pulls/comments/${commentId}`);
        return formatComment(c);
    },

    async edit_pr_comment({ owner, repo, commentId, body }) {
        await ghFetch(`/repos/${owner}/${repo}/pulls/comments/${commentId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ body: normalizeMarkdown(body) }),
        });
        return `Comment ${commentId} updated.`;
    },

    async delete_pr_comment({ owner, repo, commentId }) {
        await ghFetch(`/repos/${owner}/${repo}/pulls/comments/${commentId}`, { method: 'DELETE' });
        return `Comment ${commentId} deleted.`;
    },

    async list_pr_reviews({ owner, repo, pr }) {
        const reviews = await ghFetchAll(`/repos/${owner}/${repo}/pulls/${pr}/reviews`);
        if (!reviews.length) return 'No reviews found.';
        return reviews.map(formatReview).join('\n\n---\n\n');
    },

    async edit_pr_review({ owner, repo, pr, reviewId, body }) {
        await ghFetch(`/repos/${owner}/${repo}/pulls/${pr}/reviews/${reviewId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ body: normalizeMarkdown(body) }),
        });
        return `Review ${reviewId} updated.`;
    },

    async list_issue_comments({ owner, repo, issue }) {
        const comments = await ghFetchAll(`/repos/${owner}/${repo}/issues/${issue}/comments`);
        if (!comments.length) return 'No issue comments found.';
        return comments.map(formatComment).join('\n\n---\n\n');
    },

    async add_issue_comment({ owner, repo, issue, body }) {
        const c = await ghFetch(`/repos/${owner}/${repo}/issues/${issue}/comments`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ body: normalizeMarkdown(body) }),
        });
        return `Comment added. ID: ${c.id}\nURL: ${c.html_url}`;
    },

    async edit_issue_comment({ owner, repo, commentId, body }) {
        await ghFetch(`/repos/${owner}/${repo}/issues/comments/${commentId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ body: normalizeMarkdown(body) }),
        });
        return `Issue comment ${commentId} updated.`;
    },

    async delete_issue_comment({ owner, repo, commentId }) {
        await ghFetch(`/repos/${owner}/${repo}/issues/comments/${commentId}`, { method: 'DELETE' });
        return `Issue comment ${commentId} deleted.`;
    },

    async create_pr({ owner, repo, title, head, base, body = '', draft = false }) {
        const pr = await ghFetch(`/repos/${owner}/${repo}/pulls`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title, head, base, body: normalizeMarkdown(body), draft }),
        });
        return [
            `PR #${pr.number} created: ${pr.title}`,
            `State:  ${pr.state}${pr.draft ? ' [DRAFT]' : ''}`,
            `Branch: ${pr.head?.ref} → ${pr.base?.ref}`,
            `URL:    ${pr.html_url}`,
        ].join('\n');
    },

    async create_review({ owner, repo, pr, event, body }) {
        const r = await ghFetch(`/repos/${owner}/${repo}/pulls/${pr}/reviews`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ event: event?.toUpperCase() || 'COMMENT', body: normalizeMarkdown(body) }),
        });
        return `Review created. ID: ${r.id}\nState: ${r.state}`;
    },

    async audit_pr_comments({ owner, repo, pr }) {
        const [comments, reviews] = await Promise.all([
            ghFetchAll(`/repos/${owner}/${repo}/pulls/${pr}/comments`),
            ghFetchAll(`/repos/${owner}/${repo}/pulls/${pr}/reviews`),
        ]);
        const lines = [`PR \#${pr} audit — ${owner}/${repo}`, `Inline comments: ${comments.length}`, `Reviews:         ${reviews.length}`];
        if (comments.length) {
            lines.push('\n--- Inline Comments ---');
            comments.forEach(c => lines.push(formatComment(c)));
        }
        if (reviews.length) {
            lines.push('\n--- Reviews ---');
            reviews.forEach(r => lines.push(formatReview(r)));
        }
        return lines.join('\n');
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
