import { inferPlanningCategory, PLANNING_CATEGORIES, PLANNING_CATEGORY_LABELS } from './taxonomy.ts';

function markdownEscape(value) {
    return String(value ?? '').replace(/\|/g, '\\|').replace(/\n+/g, ' ').trim();
}

function issueLink(source, key) {
    return source?.jiraBaseUrl ? `[${key}](${source.jiraBaseUrl}/browse/${key})` : key;
}

function linkIssueKeys(source, value) {
    return markdownEscape(value).replace(/\b[A-Z][A-Z0-9]+-\d+\b/g, (key) => issueLink(source, key));
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
    const visible = keys.slice(0, limit).map((key) => issueLink(source, key));
    const remaining = keys.length - visible.length;
    return remaining > 0 ? `${visible.join(', ')} (+${remaining} more)` : visible.join(', ');
}

function appendCountTable(lines, title, counts) {
    const entries = sortedCountEntries(counts).slice(0, 12);
    if (!entries.length) return;
    lines.push(`### ${title}`, '');
    lines.push('| Value | Count |');
    lines.push('| --- | ---: |');
    for (const [value, count] of entries) lines.push(`| ${markdownEscape(value)} | ${count} |`);
    lines.push('');
}

function appendReadableOverview(lines, analysis, categories, source) {
    const issues = allCategoryIssues(categories);
    const duplicateCount = analysis.duplicateGroups?.length || 0;
    const dedupeCount = issues.filter((issue) => issue.actionBucket === 'deduplicate').length;
    const immediateCount = issues.filter((issue) => issue.actionBucket === 'do_now').length;
    const groomCount = issues.filter((issue) => issue.actionBucket === 'groom_first').length;

    lines.push('## Readable Overview', '');
    lines.push(`- Ideas / epics: ${analysis.ideas?.length || 0}`);
    lines.push(`- Immediate work candidates: ${immediateCount}`);
    lines.push(`- Groom-first candidates: ${groomCount}`);
    lines.push(`- Issues marked for deduplication: ${dedupeCount}`);
    lines.push(`- Duplicate groups: ${duplicateCount}`);
    lines.push('');

    lines.push('### Top Global Issues', '');
    lines.push('| Issue | Score | Importance | Planning | Action | Domain | Title |');
    lines.push('| --- | ---: | --- | --- | --- | --- | --- |');
    for (const issue of topIssues(issues)) {
        const planningCategory = inferPlanningCategory(issue);
        lines.push(`| ${issueLink(source, issue.key)} | ${issue.score} | ${issue.importance} | ${PLANNING_CATEGORY_LABELS[planningCategory]} | ${markdownEscape(issue.actionBucket)} | ${markdownEscape(issue.productDomain)} | ${linkIssueKeys(source, issue.title)} |`);
    }
    lines.push('');

    lines.push('### Category Overview', '');
    lines.push('| Category | Issues | Features | Improvements | Bugs | Critical/High | Deduplicate | Groom First |');
    lines.push('| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
    for (const category of Object.values(categories || {})) {
        const categoryIssues = category?.rankedIssues || [];
        lines.push([
            markdownEscape(category?.label || 'Unknown'),
            categoryIssues.length,
            categoryIssues.filter((issue) => inferPlanningCategory(issue) === 'planned_feature').length,
            categoryIssues.filter((issue) => inferPlanningCategory(issue) === 'improvement').length,
            categoryIssues.filter((issue) => inferPlanningCategory(issue) === 'bug').length,
            categoryIssues.filter((issue) => ['critical', 'high'].includes(issue.importance)).length,
            categoryIssues.filter((issue) => issue.actionBucket === 'deduplicate').length,
            categoryIssues.filter((issue) => issue.actionBucket === 'groom_first').length,
        ].join(' | ').replace(/^/, '| ').replace(/$/, ' |'));
    }
    lines.push('');

    appendCountTable(lines, 'Action Buckets', countBy(issues, 'actionBucket'));
    appendCountTable(lines, 'Planning Categories', countByPlanningCategory(issues));
    appendCountTable(lines, 'Product Domains', countBy(issues, 'productDomain'));
    appendCountTable(lines, 'Task Kinds', countBy(issues, 'taskKind'));
    appendCountTable(lines, 'Work Areas', countBy(issues, 'workArea'));

    lines.push('### Top Duplicate Cleanup Groups', '');
    if (!duplicateCount) {
        lines.push('No duplicate cleanup groups detected.', '');
        return;
    }
    lines.push('| Confidence | Canonical | Issues | Reason |');
    lines.push('| --- | --- | --- | --- |');
    for (const group of topDuplicateGroups(analysis.duplicateGroups)) {
        lines.push(`| ${group.confidence} | ${issueLink(source, group.recommendedCanonicalKey)} | ${issueLinksPreview(source, group.issueKeys || [])} | ${linkIssueKeys(source, group.reason)} |`);
    }
    lines.push('');
}

function appendIdeasSection(lines, ideas, source) {
    if (!ideas?.length) { lines.push('No ideas were synthesized.', ''); return; }
    const importanceRank = { critical: 4, high: 3, medium: 2, low: 1 };
    const ordered = [...ideas].sort((a, b) => (importanceRank[b.importance] || 0) - (importanceRank[a.importance] || 0) || (b.relatedIssues?.length || 0) - (a.relatedIssues?.length || 0));
    for (const idea of ordered) {
        const related = idea.relatedIssues || [];
        const core = related.filter((r) => r.role === 'core').map((r) => issueLink(source, r.key));
        const supporting = related.filter((r) => r.role !== 'core').map((r) => issueLink(source, r.key));
        lines.push(`### ${linkIssueKeys(source, idea.title)} — ${idea.importance} · ${idea.scopeEstimate} · ${related.length} task${related.length === 1 ? '' : 's'}`, '');
        if (idea.problemStatement) lines.push(`- Problem: ${linkIssueKeys(source, idea.problemStatement)}`);
        if (idea.goal) lines.push(`- Goal: ${linkIssueKeys(source, idea.goal)}`);
        if (idea.rationale) lines.push(`- Rationale: ${linkIssueKeys(source, idea.rationale)}`);
        if (idea.productDomain && idea.productDomain !== 'unknown') lines.push(`- Domain: ${markdownEscape(idea.productDomain)}`);
        lines.push(`- Core tasks: ${core.join(', ') || '(none)'}`);
        lines.push(`- Supporting tasks: ${supporting.join(', ') || '(none)'}`);
        if (idea.notes) lines.push(`- Notes: ${linkIssueKeys(source, idea.notes)}`);
        lines.push('');
    }
}

function appendDuplicateCandidateSection(lines, duplicateGroups, source) {
    if (!duplicateGroups?.length) { lines.push('No duplicate candidates detected.'); return; }
    lines.push('| Group | Confidence | Canonical | Candidates | Reason |');
    lines.push('| --- | --- | --- | --- | --- |');
    for (const group of duplicateGroups) {
        const candidateKeys = (group.issueKeys || []).filter((key) => key !== group.recommendedCanonicalKey);
        lines.push(`| ${markdownEscape(group.groupId)} | ${group.confidence} | ${issueLink(source, group.recommendedCanonicalKey)} | ${issueLinksPreview(source, candidateKeys, 20) || '(none)'} | ${linkIssueKeys(source, group.reason)} |`);
    }
}

function appendGroupSection(lines, title, groups, source) {
    const entries = Object.entries(groups || {})
        .filter(([, keys]) => Array.isArray(keys) && keys.length)
        .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
    if (!entries.length) return;
    lines.push(`### ${title}`, '');
    for (const [name, keys] of entries) lines.push(`- ${linkIssueKeys(source, name)}: ${keys.map((k) => issueLink(source, k)).join(', ')}`);
    lines.push('');
}

function appendRankedIssuesSection(lines, rankedIssues, source) {
    if (!rankedIssues?.length) { lines.push('No issues in this category.', ''); return; }
    lines.push('| Rank | Issue | Importance | Score | Area | Domain | Kind | Action | Duplicate | Title |');
    lines.push('| ---: | --- | --- | ---: | --- | --- | --- | --- | --- | --- |');
    for (const issue of rankedIssues) {
        const dup = issue.duplicateOf
            ? `dup:${issueLink(source, issue.duplicateOf)}`
            : issue.possibleDuplicateOf
                ? `possible:${issueLink(source, issue.possibleDuplicateOf)}`
                : '';
        lines.push(`| ${issue.rank} | ${issueLink(source, issue.key)} | ${issue.importance} | ${issue.score} | ${markdownEscape(issue.workArea)} | ${markdownEscape(issue.productDomain)} | ${markdownEscape(issue.taskKind)} | ${markdownEscape(issue.actionBucket)} | ${dup} | ${linkIssueKeys(source, issue.title)} |`);
    }
    lines.push('');
}

function planningCategoryIssues(rankedIssues, planningCategory) {
    return (rankedIssues || []).filter((issue) => inferPlanningCategory(issue) === planningCategory);
}

function appendPlanningSplitSection(lines, rankedIssues, source) {
    lines.push('### Planning Split', '');
    for (const planningCategory of PLANNING_CATEGORIES) {
        const issues = planningCategoryIssues(rankedIssues, planningCategory);
        lines.push(`#### ${PLANNING_CATEGORY_LABELS[planningCategory]} (${issues.length})`, '');
        appendRankedIssuesSection(lines, issues, source);
    }
}

function appendThemesSection(lines, themes, source) {
    if (!themes?.length) { lines.push('No themes returned by the model.', ''); return; }
    lines.push('| Theme | Importance | Issues | Notes |');
    lines.push('| --- | --- | --- | --- |');
    for (const t of themes) lines.push(`| ${linkIssueKeys(source, t.name)} | ${t.importance} | ${(t.issueKeys || []).map((key) => issueLink(source, key)).join(', ')} | ${linkIssueKeys(source, t.notes)} |`);
    lines.push('');
}

function appendReasoningSection(lines, rankedIssues, source) {
    if (!rankedIssues?.length) { lines.push('No reasoning available.', ''); return; }
    for (const issue of rankedIssues) {
        lines.push(`#### ${issue.rank}. ${issueLink(source, issue.key)} — ${linkIssueKeys(source, issue.title)}`, '');
        lines.push(`- Importance: ${issue.importance}; confidence: ${issue.confidence}; score: ${issue.score}`);
        lines.push(`- Area: ${markdownEscape(issue.workArea)}; domain: ${markdownEscape(issue.productDomain)}; kind: ${markdownEscape(issue.taskKind)}; action: ${markdownEscape(issue.actionBucket)}`);
        if (issue.systems?.length) lines.push(`- Systems: ${issue.systems.map((system) => linkIssueKeys(source, system)).join(', ')}`);
        if (issue.projectThemes?.length) lines.push(`- Project themes: ${issue.projectThemes.map((theme) => linkIssueKeys(source, theme)).join(', ')}`);
        if (issue.possibleDuplicateOf) lines.push(`- Possible duplicate of: ${issueLink(source, issue.possibleDuplicateOf)} (${issue.duplicateConfidence || 'low'}). ${linkIssueKeys(source, issue.duplicateReason || '')}`);
        lines.push('');
        lines.push(linkIssueKeys(source, issue.reasoning || 'No reasoning provided.'), '');
    }
}

function appendCategorySection(lines, category, source) {
    if (!category) return;
    const count = (category.rankedIssues || []).length;
    lines.push(`## ${category.label} (${count})`, '');
    appendPlanningSplitSection(lines, category.rankedIssues, source);
    lines.push('### All Ranked Issues', '');
    appendRankedIssuesSection(lines, category.rankedIssues, source);
    lines.push('### Groups', '');
    appendGroupSection(lines, 'By Work Area', category.groups?.byWorkArea, source);
    appendGroupSection(lines, 'By Product Domain', category.groups?.byProductDomain, source);
    appendGroupSection(lines, 'By Task Kind', category.groups?.byTaskKind, source);
    appendGroupSection(lines, 'By Planning Category', category.groups?.byPlanningCategory, source);
    appendGroupSection(lines, 'By Action Bucket', category.groups?.byActionBucket, source);
    appendGroupSection(lines, 'By Project Theme', category.groups?.byProjectTheme, source);
    appendGroupSection(lines, 'By System', category.groups?.bySystem, source);
    lines.push('### Themes', '');
    appendThemesSection(lines, category.themes, source);
    lines.push('### Detailed Reasoning', '');
    appendReasoningSection(lines, category.rankedIssues, source);
}

export function renderIdeasReport(payload) {
    const { source, ideas, synthesizedAt, model, totalIssues } = payload;
    const lines = [
        '# QIN Backlog Ideas', '',
        `- Synthesized at: ${synthesizedAt}`,
        `- Model: ${model}`,
        `- Total issues: ${totalIssues}`,
        `- Ideas: ${ideas?.length || 0}`,
        '',
    ];
    appendIdeasSection(lines, ideas, source);
    return lines.join('\n');
}

export function renderMarkdownReport(payload) {
    const { source, analysis } = payload;
    const categories = analysis.categories || {};

    const lines = [
        '# QIN Backlog Analysis', '',
        `- Analyzed at: ${payload.analyzedAt}`,
        `- Model: ${payload.model}`,
        `- Reviewed issues: ${payload.reviewedIssueCount}`,
        `- Chunk size: ${payload.chunkSize || 'n/a'}`,
        `- JQL: \`${source?.jql || ''}\``,
        '', '## Summary', '',
        linkIssueKeys(source, analysis.summary?.overallAssessment || 'No summary provided.'), '',
        `Recommended next step: ${linkIssueKeys(source, analysis.summary?.recommendedNextStep || 'No recommendation provided.')}`,
        '',
    ];

    appendReadableOverview(lines, analysis, categories, source);

    lines.push('## Ideas / Epics', '');
    appendIdeasSection(lines, analysis.ideas, source);

    lines.push('## Duplicate Candidates', '');
    appendDuplicateCandidateSection(lines, analysis.duplicateGroups, source);

    lines.push('', '## Duplicates Detail', '');
    for (const g of analysis.duplicateGroups || []) {
        lines.push(`### ${markdownEscape(g.groupId)} (${g.confidence})`, '');
        lines.push(`Issues: ${(g.issueKeys || []).map((k) => issueLink(source, k)).join(', ')}`);
        lines.push(`Canonical: ${issueLink(source, g.recommendedCanonicalKey)}`);
        lines.push(`Reason: ${linkIssueKeys(source, g.reason)}`, '');
    }

    appendCategorySection(lines, categories.josh, source);
    appendCategorySection(lines, categories.old, source);
    appendCategorySection(lines, categories.rest, source);

    if (payload.warnings?.length) {
        lines.push('## Warnings', '');
        for (const w of payload.warnings) lines.push(`- ${linkIssueKeys(source, w)}`);
        lines.push('');
    }

    return lines.join('\n');
}
