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

export function renderMarkdownReport(payload) {
    const { source, analysis } = payload;
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
    lines.push('', '## Ranked Issues', '',
        '| Rank | Issue | Importance | Score | Area | Domain | Kind | Action | Duplicate | Title |',
        '| ---: | --- | --- | ---: | --- | --- | --- | --- | --- | --- |');

    for (const issue of analysis.rankedIssues || []) {
        const dup = issue.duplicateOf
            ? `duplicate of ${issue.duplicateOf}`
            : issue.possibleDuplicateOf ? `possible of ${issue.possibleDuplicateOf} (${issue.duplicateConfidence || 'low'})` : '';
        lines.push([issue.rank, issueLink(source, issue.key), issue.importance, issue.score, issue.workArea, issue.productDomain, issue.taskKind, issue.actionBucket, markdownEscape(dup), markdownEscape(issue.title)].join(' | '));
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
            lines.push(`- ${group.groupId}: ${group.issueKeys.map((k) => issueLink(source, k)).join(', ')} (${group.confidence}); canonical: ${issueLink(source, group.recommendedCanonicalKey)}`);
            lines.push(`  ${group.reason}`);
        }
    } else { lines.push('No duplicate groups detected.'); }

    if (payload.warnings?.length) {
        lines.push('', '## Warnings', '');
        for (const w of payload.warnings) lines.push(`- ${markdownEscape(w)}`);
    }

    lines.push('', '## Themes', '');
    if (analysis.themes?.length) {
        lines.push('| Theme | Importance | Issues | Notes |', '| --- | --- | --- | --- |');
        for (const theme of analysis.themes) {
            lines.push([markdownEscape(theme.name), theme.importance, (theme.issueKeys || []).map((k) => issueLink(source, k)).join(', '), markdownEscape(theme.notes)].join(' | '));
        }
    } else { lines.push('No themes returned by the model.'); }

    lines.push('', '## Detailed Reasoning', '');
    for (const issue of analysis.rankedIssues || []) {
        lines.push(`### ${issue.rank}. ${issue.key} - ${issue.title}`, '');
        lines.push(`Importance: ${issue.importance}; confidence: ${issue.confidence}; score: ${issue.score}`);
        lines.push(`Area: ${issue.workArea}; domain: ${issue.productDomain}; kind: ${issue.taskKind}; action: ${issue.actionBucket}`);
        if (issue.systems?.length) lines.push(`Systems: ${issue.systems.join(', ')}`);
        if (issue.projectThemes?.length) lines.push(`Project themes: ${issue.projectThemes.join(', ')}`);
        if (issue.possibleDuplicateOf) lines.push(`Possible duplicate of: ${issue.possibleDuplicateOf} (${issue.duplicateConfidence || 'low'}). ${issue.duplicateReason || ''}`);
        lines.push('', issue.reasoning || 'No reasoning provided.', '');
    }

    return `${lines.join('\n')}\n`;
}
