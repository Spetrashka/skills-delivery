function htmlEscape(value) {
    return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
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

function renderDuplicateCandidateRows(duplicateGroups, source) {
    if (!duplicateGroups?.length) return '<tr><td colspan="5" class="muted">No duplicate candidates detected.</td></tr>';
    return duplicateGroups.map((group) => {
        const candidates = (group.issueKeys || []).filter((k) => k !== group.recommendedCanonicalKey).map((k) => issueHtmlLink(source, k)).join(', ');
        return `<tr><td>${htmlEscape(group.groupId)}</td><td>${badge(group.confidence)}</td><td>${issueHtmlLink(source, group.recommendedCanonicalKey)}</td><td>${candidates || '<span class="muted">(none)</span>'}</td><td>${htmlEscape(group.reason)}</td></tr>`;
    }).join('\n');
}

function renderGroupBlock(title, groups, source) {
    const entries = Object.entries(groups || {})
        .filter(([, keys]) => Array.isArray(keys) && keys.length)
        .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
    if (!entries.length) return '';
    const items = entries.map(([name, keys]) => `<li><strong>${htmlEscape(name)}:</strong> ${keys.map((key) => issueHtmlLink(source, key)).join(', ')}</li>`).join('\n');
    return `<h3>${htmlEscape(title)}</h3><ul class="group-list">${items}</ul>`;
}

function renderGroups(groups, source) {
    return [
        renderGroupBlock('By Work Area', groups?.byWorkArea, source),
        renderGroupBlock('By Product Domain', groups?.byProductDomain, source),
        renderGroupBlock('By Task Kind', groups?.byTaskKind, source),
        renderGroupBlock('By Action Bucket', groups?.byActionBucket, source),
        renderGroupBlock('By Project Theme', groups?.byProjectTheme, source),
        renderGroupBlock('By System', groups?.bySystem, source),
    ].filter(Boolean).join('\n') || '<p class="muted">No groups available.</p>';
}

export function renderHtmlReport(payload) {
    const { source, analysis } = payload;
    const duplicateRows = renderDuplicateCandidateRows(analysis.duplicateGroups, source);
    const groups = renderGroups(analysis.groups, source);
    const rankedRows = (analysis.rankedIssues || []).map((issue) => {
        const dup = issue.duplicateOf ? `duplicate of ${issue.duplicateOf}` : issue.possibleDuplicateOf ? `possible of ${issue.possibleDuplicateOf} (${issue.duplicateConfidence || 'low'})` : '';
        return `<tr><td class="num">${issue.rank}</td><td>${issueHtmlLink(source, issue.key)}</td><td>${badge(issue.importance)}</td><td class="num">${htmlEscape(issue.score)}</td><td>${badge(issue.workArea)}</td><td>${badge(issue.productDomain)}</td><td>${badge(issue.taskKind)}</td><td>${badge(issue.actionBucket)}</td><td>${htmlEscape(dup)}</td><td>${htmlEscape(issue.title)}</td></tr>`;
    }).join('\n');

    const duplicateDetails = analysis.duplicateGroups?.length
        ? `<ul>${analysis.duplicateGroups.map((g) => `<li><strong>${htmlEscape(g.groupId)}</strong>: ${(g.issueKeys || []).map((k) => issueHtmlLink(source, k)).join(', ')} <span class="muted">(${htmlEscape(g.confidence)}); canonical: ${issueHtmlLink(source, g.recommendedCanonicalKey)}</span><div class="reason">${htmlEscape(g.reason)}</div></li>`).join('\n')}</ul>`
        : '<p class="muted">No duplicate groups detected.</p>';

    const warnings = payload.warnings?.length
        ? `<section><h2>Warnings</h2><ul>${payload.warnings.map((w) => `<li>${htmlEscape(w)}</li>`).join('\n')}</ul></section>` : '';

    const themeRows = analysis.themes?.length
        ? analysis.themes.map((t) => `<tr><td>${htmlEscape(t.name)}</td><td>${badge(t.importance)}</td><td>${(t.issueKeys || []).map((k) => issueHtmlLink(source, k)).join(', ')}</td><td>${htmlEscape(t.notes)}</td></tr>`).join('\n')
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
        h1 { font-size: 28px; margin: 0 0 16px; } h2 { margin: 28px 0 12px; font-size: 20px; } h3 { margin: 20px 0 8px; font-size: 16px; }
        section { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 16px; margin: 16px 0; }
        a { color: var(--link); text-decoration: none; } a:hover { text-decoration: underline; }
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
        .group-list { margin-top: 6px; }
        .group-list li { margin: 4px 0; }
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
    <section><h2>Summary</h2><p>${htmlEscape(analysis.summary?.overallAssessment || 'No summary provided.')}</p><p><strong>Recommended next step:</strong> ${htmlEscape(analysis.summary?.recommendedNextStep || 'No recommendation provided.')}</p></section>
    <section><h2>Duplicate Candidates</h2><div class="table-wrap"><table><thead><tr><th>Group</th><th>Confidence</th><th>Canonical</th><th>Candidates</th><th>Reason</th></tr></thead><tbody>${duplicateRows}</tbody></table></div></section>
    <section><h2>Ranked Issues</h2><div class="table-wrap"><table><thead><tr><th>Rank</th><th>Issue</th><th>Importance</th><th>Score</th><th>Area</th><th>Domain</th><th>Kind</th><th>Action</th><th>Duplicate</th><th>Title</th></tr></thead><tbody>${rankedRows}</tbody></table></div></section>
    <section><h2>Groups</h2>${groups}</section>
    <section><h2>Duplicates Detail</h2>${duplicateDetails}</section>
    ${warnings}
    <section><h2>Themes</h2><div class="table-wrap"><table><thead><tr><th>Theme</th><th>Importance</th><th>Issues</th><th>Notes</th></tr></thead><tbody>${themeRows}</tbody></table></div></section>
    <section><h2>Detailed Reasoning</h2>${reasoning}</section>
</main>
</body>
</html>
`;
}
