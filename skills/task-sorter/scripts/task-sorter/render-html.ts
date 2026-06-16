import { inferPlanningCategory, PLANNING_CATEGORIES, PLANNING_CATEGORY_LABELS } from './taxonomy.ts';

function htmlEscape(value) {
    return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function issueHtmlLink(source, key) {
    const label = htmlEscape(key);
    return source?.jiraBaseUrl
        ? `<a href="${htmlEscape(`${source.jiraBaseUrl}/browse/${key}`)}" target="_blank" rel="noreferrer">${label}</a>`
        : label;
}

function linkIssueKeys(source, value) {
    return htmlEscape(value).replace(/\b[A-Z][A-Z0-9]+-\d+\b/g, (key) => issueHtmlLink(source, key));
}

function allCategoryIssues(categories) {
    return Object.values(categories || {}).flatMap((category) => category?.rankedIssues || []);
}

function countBy(items, field) {
    return items.reduce((counts, item) => {
        const key = item?.[field] || 'unknown';
        counts[key] = (counts[key] || 0) + 1;
        return counts;
    }, {});
}

function countByPlanningCategory(items) {
    return items.reduce((counts, item) => {
        const key = inferPlanningCategory(item);
        counts[PLANNING_CATEGORY_LABELS[key]] = (counts[PLANNING_CATEGORY_LABELS[key]] || 0) + 1;
        return counts;
    }, {});
}

function sortedCountEntries(counts) {
    return Object.entries(counts || {}).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function importanceWeight(issue) {
    return { critical: 4, high: 3, medium: 2, low: 1 }[issue?.importance] || 0;
}

function topIssues(issues, limit = 15) {
    return [...issues]
        .sort((a, b) => (b.score || 0) - (a.score || 0) || importanceWeight(b) - importanceWeight(a) || String(a.key).localeCompare(String(b.key)))
        .slice(0, limit);
}

function topDuplicateGroups(groups, limit = 10) {
    const confidenceWeight = { high: 3, medium: 2, low: 1 };
    return [...(groups || [])]
        .sort((a, b) => (confidenceWeight[b.confidence] || 0) - (confidenceWeight[a.confidence] || 0) || (b.issueKeys?.length || 0) - (a.issueKeys?.length || 0))
        .slice(0, limit);
}

function issueLinksPreview(source, keys = [], limit = 12) {
    const visible = keys.slice(0, limit).map((key) => issueHtmlLink(source, key));
    const remaining = keys.length - visible.length;
    return remaining > 0 ? `${visible.join(', ')} <span class="muted">(+${remaining} more)</span>` : visible.join(', ');
}

function renderCountRows(counts) {
    return sortedCountEntries(counts).slice(0, 12)
        .map(([value, count]) => `<tr><td>${htmlEscape(value)}</td><td class="num">${htmlEscape(count)}</td></tr>`)
        .join('\n');
}

function renderReadableOverview(analysis, categories, source) {
    const issues = allCategoryIssues(categories);
    const duplicateCount = analysis.duplicateGroups?.length || 0;
    const dedupeCount = issues.filter((issue) => issue.actionBucket === 'deduplicate').length;
    const immediateCount = issues.filter((issue) => issue.actionBucket === 'do_now').length;
    const groomCount = issues.filter((issue) => issue.actionBucket === 'groom_first').length;
    const topIssueRows = topIssues(issues).map((issue) => {
        const planningCategory = inferPlanningCategory(issue);
        return `<tr><td>${issueHtmlLink(source, issue.key)}</td><td class="num">${htmlEscape(issue.score)}</td><td>${badge(issue.importance)}</td><td>${htmlEscape(PLANNING_CATEGORY_LABELS[planningCategory])}</td><td>${badge(issue.actionBucket)}</td><td>${badge(issue.productDomain)}</td><td>${linkIssueKeys(source, issue.title)}</td></tr>`;
    }).join('\n');
    const categoryRows = Object.values(categories || {}).map((category) => {
        const categoryIssues = category?.rankedIssues || [];
        return `<tr><td>${htmlEscape(category?.label || 'Unknown')}</td><td class="num">${categoryIssues.length}</td><td class="num">${categoryIssues.filter((issue) => inferPlanningCategory(issue) === 'planned_feature').length}</td><td class="num">${categoryIssues.filter((issue) => inferPlanningCategory(issue) === 'improvement').length}</td><td class="num">${categoryIssues.filter((issue) => inferPlanningCategory(issue) === 'bug').length}</td><td class="num">${categoryIssues.filter((issue) => ['critical', 'high'].includes(issue.importance)).length}</td><td class="num">${categoryIssues.filter((issue) => issue.actionBucket === 'deduplicate').length}</td><td class="num">${categoryIssues.filter((issue) => issue.actionBucket === 'groom_first').length}</td></tr>`;
    }).join('\n');
    const duplicateRows = topDuplicateGroups(analysis.duplicateGroups).map((group) => `<tr><td>${badge(group.confidence)}</td><td>${issueHtmlLink(source, group.recommendedCanonicalKey)}</td><td>${issueLinksPreview(source, group.issueKeys || [])}</td><td>${linkIssueKeys(source, group.reason)}</td></tr>`).join('\n');

    return `<details class="sec" open><summary>Readable Overview</summary><div class="sec-body">
        <div class="metric-grid">
            <div class="metric"><span>${analysis.ideas?.length || 0}</span><label>Ideas / epics</label></div>
            <div class="metric"><span>${immediateCount}</span><label>Immediate</label></div>
            <div class="metric"><span>${groomCount}</span><label>Groom first</label></div>
            <div class="metric"><span>${dedupeCount}</span><label>Deduplicate</label></div>
            <div class="metric"><span>${duplicateCount}</span><label>Duplicate groups</label></div>
        </div>
        <h3>Top Global Issues</h3>
        <div class="table-wrap"><table><thead><tr><th>Issue</th><th>Score</th><th>Importance</th><th>Planning</th><th>Action</th><th>Domain</th><th>Title</th></tr></thead><tbody>${topIssueRows}</tbody></table></div>
        <h3>Category Overview</h3>
        <div class="table-wrap"><table><thead><tr><th>Category</th><th>Issues</th><th>Features</th><th>Improvements</th><th>Bugs</th><th>Critical/High</th><th>Deduplicate</th><th>Groom First</th></tr></thead><tbody>${categoryRows}</tbody></table></div>
        <div class="overview-grid">
            <div><h3>Action Buckets</h3><div class="table-wrap"><table><tbody>${renderCountRows(countBy(issues, 'actionBucket'))}</tbody></table></div></div>
            <div><h3>Planning Categories</h3><div class="table-wrap"><table><tbody>${renderCountRows(countByPlanningCategory(issues))}</tbody></table></div></div>
            <div><h3>Product Domains</h3><div class="table-wrap"><table><tbody>${renderCountRows(countBy(issues, 'productDomain'))}</tbody></table></div></div>
            <div><h3>Task Kinds</h3><div class="table-wrap"><table><tbody>${renderCountRows(countBy(issues, 'taskKind'))}</tbody></table></div></div>
            <div><h3>Work Areas</h3><div class="table-wrap"><table><tbody>${renderCountRows(countBy(issues, 'workArea'))}</tbody></table></div></div>
        </div>
        <h3>Top Duplicate Cleanup Groups</h3>
        <div class="table-wrap"><table><thead><tr><th>Confidence</th><th>Canonical</th><th>Issues</th><th>Reason</th></tr></thead><tbody>${duplicateRows || '<tr><td colspan="4" class="muted">No duplicate cleanup groups detected.</td></tr>'}</tbody></table></div>
    </div></details>`;
}

function badge(value) {
    const safe = htmlEscape(value || 'unknown');
    return `<span class="badge badge-${safe.replace(/[^a-z0-9_-]/gi, '-')}">${safe}</span>`;
}

function renderIdeas(ideas, source) {
    if (!ideas?.length) return '<p class="muted">No ideas were synthesized.</p>';
    const importanceRank = { critical: 4, high: 3, medium: 2, low: 1 };
    const ordered = [...ideas].sort((a, b) => (importanceRank[b.importance] || 0) - (importanceRank[a.importance] || 0) || (b.relatedIssues?.length || 0) - (a.relatedIssues?.length || 0));
    return ordered.map((idea) => {
        const related = idea.relatedIssues || [];
        const core = related.filter((r) => r.role === 'core').map((r) => issueHtmlLink(source, r.key)).join(', ');
        const supporting = related.filter((r) => r.role !== 'core').map((r) => issueHtmlLink(source, r.key)).join(', ');
        const domain = idea.productDomain && idea.productDomain !== 'unknown' ? badge(idea.productDomain) : '';
        const meta = [idea.problemStatement ? `<p><strong>Problem:</strong> ${linkIssueKeys(source, idea.problemStatement)}</p>` : '',
            idea.goal ? `<p><strong>Goal:</strong> ${linkIssueKeys(source, idea.goal)}</p>` : '',
            idea.rationale ? `<p><strong>Rationale:</strong> ${linkIssueKeys(source, idea.rationale)}</p>` : '',
            idea.notes ? `<p><strong>Notes:</strong> ${linkIssueKeys(source, idea.notes)}</p>` : ''].join('');
        return `<details class="item" open><summary>${linkIssueKeys(source, idea.title)} ${badge(idea.importance)} ${badge(idea.scopeEstimate)} ${domain} <span class="cnt">(${related.length} task${related.length === 1 ? '' : 's'})</span></summary>${meta}<p><strong>Core:</strong> ${core || '<span class="muted">(none)</span>'}</p><p><strong>Supporting:</strong> ${supporting || '<span class="muted">(none)</span>'}</p></details>`;
    }).join('\n');
}

function renderDuplicateCandidateRows(duplicateGroups, source) {
    if (!duplicateGroups?.length) return '<tr><td colspan="5" class="muted">No duplicate candidates detected.</td></tr>';
    return duplicateGroups.map((group) => {
        const candidates = (group.issueKeys || []).filter((k) => k !== group.recommendedCanonicalKey).map((k) => issueHtmlLink(source, k)).join(', ');
        return `<tr><td>${htmlEscape(group.groupId)}</td><td>${badge(group.confidence)}</td><td>${issueHtmlLink(source, group.recommendedCanonicalKey)}</td><td>${candidates || '<span class="muted">(none)</span>'}</td><td>${linkIssueKeys(source, group.reason)}</td></tr>`;
    }).join('\n');
}

function renderGroupBlock(title, groups, source) {
    const entries = Object.entries(groups || {})
        .filter(([, keys]) => Array.isArray(keys) && keys.length)
        .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
    if (!entries.length) return '';
    const items = entries.map(([name, keys]) => `<li><strong>${linkIssueKeys(source, name)}:</strong> ${keys.map((key) => issueHtmlLink(source, key)).join(', ')}</li>`).join('\n');
    return `<h3>${htmlEscape(title)}</h3><ul class="group-list">${items}</ul>`;
}

function renderGroups(groups, source) {
    return [
        renderGroupBlock('By Work Area', groups?.byWorkArea, source),
        renderGroupBlock('By Product Domain', groups?.byProductDomain, source),
        renderGroupBlock('By Task Kind', groups?.byTaskKind, source),
        renderGroupBlock('By Planning Category', groups?.byPlanningCategory, source),
        renderGroupBlock('By Action Bucket', groups?.byActionBucket, source),
        renderGroupBlock('By Project Theme', groups?.byProjectTheme, source),
        renderGroupBlock('By System', groups?.bySystem, source),
    ].filter(Boolean).join('\n') || '<p class="muted">No groups available.</p>';
}

function renderRankedRows(rankedIssues, source) {
    return (rankedIssues || []).map((issue) => {
        const dup = issue.duplicateOf
            ? `duplicate of ${issueHtmlLink(source, issue.duplicateOf)}`
            : issue.possibleDuplicateOf
                ? `possible of ${issueHtmlLink(source, issue.possibleDuplicateOf)} (${htmlEscape(issue.duplicateConfidence || 'low')})`
                : '';
        return `<tr><td class="num">${issue.rank}</td><td>${issueHtmlLink(source, issue.key)}</td><td>${badge(issue.importance)}</td><td class="num">${htmlEscape(issue.score)}</td><td>${badge(issue.workArea)}</td><td>${badge(issue.productDomain)}</td><td>${badge(issue.taskKind)}</td><td>${badge(issue.actionBucket)}</td><td>${dup}</td><td>${linkIssueKeys(source, issue.title)}</td></tr>`;
    }).join('\n');
}

function planningCategoryIssues(rankedIssues, planningCategory) {
    return (rankedIssues || []).filter((issue) => inferPlanningCategory(issue) === planningCategory);
}

function renderPlanningSplit(rankedIssues, source) {
    return PLANNING_CATEGORIES.map((planningCategory) => {
        const issues = planningCategoryIssues(rankedIssues, planningCategory);
        const rankedRows = renderRankedRows(issues, source);
        return `<details class="sec inner"><summary>${htmlEscape(PLANNING_CATEGORY_LABELS[planningCategory])} <span class="cnt">(${issues.length})</span></summary><div class="sec-body"><div class="table-wrap"><table><thead><tr><th>Rank</th><th>Issue</th><th>Importance</th><th>Score</th><th>Area</th><th>Domain</th><th>Kind</th><th>Action</th><th>Duplicate</th><th>Title</th></tr></thead><tbody>${rankedRows || '<tr><td colspan="10" class="muted">No issues in this planning category.</td></tr>'}</tbody></table></div></div></details>`;
    }).join('\n');
}

function renderThemeRows(themes, source) {
    return (themes || []).length
        ? (themes || []).map((t) => `<tr><td>${linkIssueKeys(source, t.name)}</td><td>${badge(t.importance)}</td><td>${(t.issueKeys || []).map((k) => issueHtmlLink(source, k)).join(', ')}</td><td>${linkIssueKeys(source, t.notes)}</td></tr>`).join('\n')
        : '<tr><td colspan="4" class="muted">No themes returned by the model.</td></tr>';
}

function renderReasoning(rankedIssues, source) {
    return (rankedIssues || []).map((issue) => {
        const systems = issue.systems?.length ? `<p><strong>Systems:</strong> ${issue.systems.map((system) => linkIssueKeys(source, system)).join(', ')}</p>` : '';
        const themes = issue.projectThemes?.length ? `<p><strong>Project themes:</strong> ${issue.projectThemes.map((theme) => linkIssueKeys(source, theme)).join(', ')}</p>` : '';
        const dup = issue.possibleDuplicateOf ? `<p><strong>Possible duplicate of:</strong> ${issueHtmlLink(source, issue.possibleDuplicateOf)} (${htmlEscape(issue.duplicateConfidence || 'low')}). ${linkIssueKeys(source, issue.duplicateReason || '')}</p>` : '';
        return `<details class="item"><summary>${htmlEscape(`${issue.rank}. `)}${issueHtmlLink(source, issue.key)}${htmlEscape(' - ')}${linkIssueKeys(source, issue.title)}</summary><p><strong>Importance:</strong> ${htmlEscape(issue.importance)}; <strong>confidence:</strong> ${htmlEscape(issue.confidence)}; <strong>score:</strong> ${htmlEscape(issue.score)}</p><p><strong>Area:</strong> ${htmlEscape(issue.workArea)}; <strong>domain:</strong> ${htmlEscape(issue.productDomain)}; <strong>kind:</strong> ${htmlEscape(issue.taskKind)}; <strong>action:</strong> ${htmlEscape(issue.actionBucket)}</p>${systems}${themes}${dup}<p>${linkIssueKeys(source, issue.reasoning || 'No reasoning provided.')}</p></details>`;
    }).join('\n');
}

function renderCategory(category, source) {
    if (!category) return '';
    const count = (category.rankedIssues || []).length;
    const rankedRows = renderRankedRows(category.rankedIssues, source);
    const planningSplit = renderPlanningSplit(category.rankedIssues, source);
    const groups = renderGroups(category.groups, source);
    const themeRows = renderThemeRows(category.themes, source);
    const reasoning = renderReasoning(category.rankedIssues, source);
    return `<details class="sec">
    <summary>${htmlEscape(category.label)} <span class="cnt">(${count})</span></summary>
    <div class="sec-body">
        <details class="sec inner" open><summary>Planning Split</summary><div class="sec-body">${planningSplit}</div></details>
        <details class="sec inner"><summary>All Ranked Issues</summary><div class="sec-body"><div class="table-wrap"><table><thead><tr><th>Rank</th><th>Issue</th><th>Importance</th><th>Score</th><th>Area</th><th>Domain</th><th>Kind</th><th>Action</th><th>Duplicate</th><th>Title</th></tr></thead><tbody>${rankedRows || '<tr><td colspan="10" class="muted">No issues in this category.</td></tr>'}</tbody></table></div></div></details>
        <details class="sec inner"><summary>Groups</summary><div class="sec-body">${groups}</div></details>
        <details class="sec inner"><summary>Themes</summary><div class="sec-body"><div class="table-wrap"><table><thead><tr><th>Theme</th><th>Importance</th><th>Issues</th><th>Notes</th></tr></thead><tbody>${themeRows}</tbody></table></div></div></details>
        <details class="sec inner"><summary>Detailed Reasoning</summary><div class="sec-body">${reasoning || '<p class="muted">No reasoning available.</p>'}</div></details>
    </div>
</details>`;
}

export function renderHtmlReport(payload) {
    const { source, analysis } = payload;
    const duplicateRows = renderDuplicateCandidateRows(analysis.duplicateGroups, source);
    const duplicateDetails = analysis.duplicateGroups?.length
        ? `<ul>${analysis.duplicateGroups.map((g) => `<li><strong>${htmlEscape(g.groupId)}</strong>: ${(g.issueKeys || []).map((k) => issueHtmlLink(source, k)).join(', ')} <span class="muted">(${htmlEscape(g.confidence)}); canonical: ${issueHtmlLink(source, g.recommendedCanonicalKey)}</span><div class="reason">${linkIssueKeys(source, g.reason)}</div></li>`).join('\n')}</ul>`
        : '<p class="muted">No duplicate groups detected.</p>';
    const warnings = payload.warnings?.length
        ? `<details class="sec"><summary>Warnings</summary><div class="sec-body"><ul>${payload.warnings.map((w) => `<li>${linkIssueKeys(source, w)}</li>`).join('\n')}</ul></div></details>` : '';
    const categories = analysis.categories || {};
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
        h3 { margin: 20px 0 8px; font-size: 16px; }
        a { color: var(--link); text-decoration: none; } a:hover { text-decoration: underline; }
        .meta { display: flex; flex-wrap: wrap; gap: 8px 16px; color: var(--muted); margin-bottom: 8px; }
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
        details.sec { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; margin: 12px 0; }
        details.sec.inner { margin: 8px 0; }
        details.sec > summary { cursor: pointer; list-style: none; display: flex; align-items: center; gap: 8px; padding: 12px 16px; font-size: 18px; font-weight: 700; user-select: none; }
        details.sec.inner > summary { font-size: 15px; padding: 8px 12px; }
        details.sec > summary::-webkit-details-marker { display: none; }
        details.sec > summary::before { content: '\u25B6'; font-size: 11px; color: var(--muted); transition: transform 0.15s; flex-shrink: 0; }
        details.sec[open] > summary::before { transform: rotate(90deg); }
        details.sec > summary:hover { background: color-mix(in srgb, var(--line) 20%, transparent); border-radius: 8px; }
        details.sec[open] > summary { border-bottom: 1px solid var(--line); border-radius: 8px 8px 0 0; }
        .sec-body { padding: 16px; }
        details.sec.inner .sec-body { padding: 12px; }
        details.item { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 10px 12px; margin: 8px 0; }
        details.item > summary { cursor: pointer; font-weight: 600; }
        .toolbar { display: flex; gap: 8px; margin-bottom: 4px; }
        .toolbar button { background: var(--panel); border: 1px solid var(--line); border-radius: 6px; padding: 4px 12px; cursor: pointer; color: var(--text); font-size: 13px; }
        .toolbar button:hover { background: color-mix(in srgb, var(--line) 30%, transparent); }
        .cnt { font-size: 13px; font-weight: 400; color: var(--muted); }
        .group-list { margin-top: 6px; }
        .group-list li { margin: 4px 0; }
        .metric-grid { display: grid; grid-template-columns: repeat(5, minmax(110px, 1fr)); gap: 10px; margin-bottom: 16px; }
        .metric { border: 1px solid var(--line); border-radius: 8px; padding: 12px; background: color-mix(in srgb, var(--panel) 90%, var(--line)); }
        .metric span { display: block; font-size: 24px; font-weight: 700; line-height: 1.1; }
        .metric label { display: block; color: var(--muted); margin-top: 4px; }
        .overview-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin-top: 8px; }
        @media (max-width: 760px) { .metric-grid, .overview-grid { grid-template-columns: 1fr; } }
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
    <div class="toolbar">
        <button id="expand-all" type="button">Expand all</button>
        <button id="collapse-all" type="button">Collapse all</button>
    </div>
    <details class="sec" open><summary>Summary</summary><div class="sec-body"><p>${linkIssueKeys(source, analysis.summary?.overallAssessment || 'No summary provided.')}</p><p><strong>Recommended next step:</strong> ${linkIssueKeys(source, analysis.summary?.recommendedNextStep || 'No recommendation provided.')}</p></div></details>
    ${renderReadableOverview(analysis, categories, source)}
    <details class="sec" open><summary>Ideas / Epics <span class="cnt">(${analysis.ideas?.length || 0})</span></summary><div class="sec-body">${renderIdeas(analysis.ideas, source)}</div></details>
    <details class="sec"><summary>Duplicate Candidates <span class="cnt">(${analysis.duplicateGroups?.length || 0})</span></summary><div class="sec-body"><div class="table-wrap"><table><thead><tr><th>Group</th><th>Confidence</th><th>Canonical</th><th>Candidates</th><th>Reason</th></tr></thead><tbody>${duplicateRows}</tbody></table></div></div></details>
    <details class="sec"><summary>Duplicates Detail</summary><div class="sec-body">${duplicateDetails}</div></details>
    ${renderCategory(categories.josh, source)}
    ${renderCategory(categories.old, source)}
    ${renderCategory(categories.rest, source)}
    ${warnings}
</main>
<script>
    (() => {
        const sections = () => Array.from(document.querySelectorAll('details.sec'));
        document.getElementById('expand-all')?.addEventListener('click', () => {
            sections().forEach((section) => { section.open = true; });
        });
        document.getElementById('collapse-all')?.addEventListener('click', () => {
            sections().forEach((section) => { section.open = false; });
        });
    })();
</script>
</body>
</html>
`;
}

export function renderIdeasHtmlReport(payload) {
    const { source, ideas, synthesizedAt, model, totalIssues } = payload;
    return `<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>QIN Backlog Ideas</title>
    <style>
        :root { color-scheme: light dark; --bg: #f6f7f9; --panel: #ffffff; --text: #1f2933; --muted: #667085; --line: #d7dce2; --link: #1b63a7; }
        @media (prefers-color-scheme: dark) { :root { --bg: #181b20; --panel: #22262d; --text: #e8ecf1; --muted: #a7b0bd; --line: #3a4049; --link: #8ab4f8; } }
        body { margin: 0; background: var(--bg); color: var(--text); font: 14px/1.45 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
        main { max-width: 960px; margin: 0 auto; padding: 24px; }
        h1 { font-size: 28px; margin: 0 0 16px; }
        a { color: var(--link); text-decoration: none; } a:hover { text-decoration: underline; }
        .meta { display: flex; flex-wrap: wrap; gap: 8px 16px; color: var(--muted); margin-bottom: 20px; }
        .badge { display: inline-block; border: 1px solid var(--line); border-radius: 999px; padding: 2px 8px; white-space: nowrap; }
        .badge-critical { border-color: #b42318; color: #b42318; }
        .badge-high { border-color: #b54708; color: #b54708; }
        .muted { color: var(--muted); }
        details.item { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 14px 16px; margin: 12px 0; }
        details.item > summary { cursor: pointer; font-size: 16px; font-weight: 700; list-style: none; display: flex; align-items: center; gap: 8px; }
        details.item > summary::-webkit-details-marker { display: none; }
        details.item > summary::before { content: '▶'; font-size: 11px; color: var(--muted); transition: transform 0.15s; flex-shrink: 0; }
        details.item[open] > summary::before { transform: rotate(90deg); }
        details.item p { margin: 8px 0; }
        .cnt { font-size: 13px; font-weight: 400; color: var(--muted); }
    </style>
</head>
<body>
<main>
    <h1>QIN Backlog Ideas</h1>
    <div class="meta">
        <span>Synthesized at: ${htmlEscape(synthesizedAt)}</span>
        <span>Model: ${htmlEscape(model)}</span>
        <span>Total issues: ${htmlEscape(totalIssues)}</span>
        <span>Ideas: ${ideas?.length || 0}</span>
    </div>
    ${renderIdeas(ideas, source)}
</main>
</body>
</html>
`;
}
