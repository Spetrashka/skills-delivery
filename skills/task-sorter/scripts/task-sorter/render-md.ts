function markdownEscape(value) {
    return String(value ?? '').replace(/\|/g, '\\|').replace(/\n+/g, ' ').trim();
}

function issueLink(source, key) {
    return source?.jiraBaseUrl ? `[${key}](${source.jiraBaseUrl}/browse/${key})` : key;
}

function appendDuplicateCandidateSection(lines, duplicateGroups, source) {
    if (!duplicateGroups?.length) { lines.push('No duplicate candidates detected.'); return; }
    lines.push('| Group | Confidence | Canonical | Candidates | Reason |');
    lines.push('| --- | --- | --- | --- | --- |');
    for (const group of duplicateGroups) {
        const candidates = (group.issueKeys || [])
            .filter((key) => key !== group.recommendedCanonicalKey)
            .map((key) => issueLink(source, key)).join(', ');
        lines.push([markdownEscape(group.groupId), group.confidence, issueLink(source, group.recommendedCanonicalKey), candidates || '(none)', markdownEscape(group.reason)].join(' | '));
    }
}

function appendGroupSection(lines, title, groups, source) {
    const entries = Object.entries(groups || {})
        .filter(([, keys]) => Array.isArray(keys) && keys.length)
        .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
    if (!entries.length) return;
    lines.push(`### ${title}`, '');
    for (const [name, keys] of entries) lines.push(`- ${markdownEscape(name)}: ${keys.map((k) => issueLink(source, k)).join(', ')}`);
    lines.push('');
}

function appendRankedIssuesSection(lines, rankedIssues, source) {
    if (!rankedIssues?.length) { lines.push('No issues in this category.', ''); return; }
    lines.push('| Rank | Issue | Importance | Score | Area | Domain | Kind | Action | Duplicate | Title |');
    lines.push('| ---: | --- | --- | ---: | --- | --- | --- | --- | --- | --- |');
    for (const issue of rankedIssues) {
        const dup = issue.duplicateOf ? `dup:${issue.duplicateOf}` : issue.possibleDuplicateOf ? `possible:${issue.possibleDuplicateOf}` : '';
        lines.push(`| ${issue.rank} | ${issueLink(source, issue.key)} | ${issue.importance} | ${issue.score} | ${markdownEscape(issue.workArea)} | ${markdownEscape(issue.productDomain)} | ${markdownEscape(issue.taskKind)} | ${markdownEscape(issue.actionBucket)} | ${dup} | ${markdownEscape(issue.title)} |`);
    }
    lines.push('');
}

function appendThemesSection(lines, themes) {
    if (!themes?.length) { lines.push('No themes returned by the model.', ''); return; }
    lines.push('| Theme | Importance | Issues | Notes |');
    lines.push('| --- | --- | --- | --- |');
    for (const t of themes) lines.push(`| ${markdownEscape(t.name)} | ${t.importance} | ${(t.issueKeys || []).join(', ')} | ${markdownEscape(t.notes)} |`);
    lines.push('');
}

function appendReasoningSection(lines, rankedIssues, source) {
    if (!rankedIssues?.length) { lines.push('No reasoning available.', ''); return; }
    for (const issue of rankedIssues) {
        lines.push(`#### ${issue.rank}. ${issue.key} — ${markdownEscape(issue.title)}`, '');
        lines.push(`- Importance: ${issue.importance}; confidence: ${issue.confidence}; score: ${issue.score}`);
        lines.push(`- Area: ${markdownEscape(issue.workArea)}; domain: ${markdownEscape(issue.productDomain)}; kind: ${markdownEscape(issue.taskKind)}; action: ${markdownEscape(issue.actionBucket)}`);
        if (issue.systems?.length) lines.push(`- Systems: ${issue.systems.map(markdownEscape).join(', ')}`);
        if (issue.projectThemes?.length) lines.push(`- Project themes: ${issue.projectThemes.map(markdownEscape).join(', ')}`);
        if (issue.possibleDuplicateOf) lines.push(`- Possible duplicate of: ${issueLink(source, issue.possibleDuplicateOf)} (${issue.duplicateConfidence || 'low'}). ${markdownEscape(issue.duplicateReason || '')}`);
        lines.push('');
        lines.push(markdownEscape(issue.reasoning || 'No reasoning provided.'), '');
    }
}

function appendCategorySection(lines, category, source) {
    if (!category) return;
    const count = (category.rankedIssues || []).length;
    lines.push(`## ${category.label} (${count})`, '');
    lines.push('### Ranked Issues', '');
    appendRankedIssuesSection(lines, category.rankedIssues, source);
    lines.push('### Groups', '');
    appendGroupSection(lines, 'By Work Area', category.groups?.byWorkArea, source);
    appendGroupSection(lines, 'By Product Domain', category.groups?.byProductDomain, source);
    appendGroupSection(lines, 'By Task Kind', category.groups?.byTaskKind, source);
    appendGroupSection(lines, 'By Action Bucket', category.groups?.byActionBucket, source);
    appendGroupSection(lines, 'By Project Theme', category.groups?.byProjectTheme, source);
    appendGroupSection(lines, 'By System', category.groups?.bySystem, source);
    lines.push('### Themes', '');
    appendThemesSection(lines, category.themes);
    lines.push('### Detailed Reasoning', '');
    appendReasoningSection(lines, category.rankedIssues, source);
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
        analysis.summary?.overallAssessment || 'No summary provided.', '',
        `Recommended next step: ${analysis.summary?.recommendedNextStep || 'No recommendation provided.'}`,
        '', '## Duplicate Candidates', '',
    ];

    appendDuplicateCandidateSection(lines, analysis.duplicateGroups, source);

    lines.push('', '## Duplicates Detail', '');
    for (const g of analysis.duplicateGroups || []) {
        lines.push(`### ${markdownEscape(g.groupId)} (${g.confidence})`, '');
        lines.push(`Issues: ${(g.issueKeys || []).map((k) => issueLink(source, k)).join(', ')}`);
        lines.push(`Canonical: ${issueLink(source, g.recommendedCanonicalKey)}`);
        lines.push(`Reason: ${markdownEscape(g.reason)}`, '');
    }

    appendCategorySection(lines, categories.josh, source);
    appendCategorySection(lines, categories.old, source);
    appendCategorySection(lines, categories.rest, source);

    if (payload.warnings?.length) {
        lines.push('## Warnings', '');
        for (const w of payload.warnings) lines.push(`- ${markdownEscape(w)}`);
        lines.push('');
    }

    return lines.join('\n');
}
