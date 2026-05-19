import { DuplicateReviewSchema } from './schemas.ts';
import { truncateText } from './chunk-analysis.ts';

function compactIssue(issue, sourceIssue) {
    return {
        key: issue.key,
        title: issue.title || sourceIssue?.title || issue.key,
        sourceTitle: sourceIssue?.title,
        description: truncateText(sourceIssue?.description, 700),
        importance: issue.importance,
        score: issue.score,
        workArea: issue.workArea,
        productDomain: issue.productDomain,
        taskKind: issue.taskKind,
        systems: issue.systems || [],
        projectThemes: issue.projectThemes || [],
        suggestedAction: issue.suggestedAction,
    };
}

function duplicateReviewMessages(exportPayload, compactIssues) {
    return [
        {
            role: 'system',
            content: [
                'You are reviewing an already ranked Jira backlog for duplicate or overlapping work.',
                'Analyze the full compact issue list semantically. Do not rely on exact wording only.',
                'A duplicate/overlap means two or more issues appear to ask for the same outcome, same fix, same migration slice, same investigation, or work that should probably be consolidated before planning.',
                'Do not group issues merely because they share a broad product domain, system, epic, or technology. There must be overlapping requested work or acceptance criteria.',
                'Prefer smaller precise groups over broad fuzzy groups. Use low confidence when evidence is incomplete.',
                'Return only duplicateGroups. Use issue keys exactly as provided. Do not include prose outside the structured response.',
            ].join('\n'),
        },
        { role: 'user', content: JSON.stringify({ source: exportPayload.source, issues: compactIssues }) },
    ];
}

export async function reviewBacklogDuplicates(model, exportPayload, sourceIssues, rankedIssues, warnings, options) {
    const maxIssues = Number(options['duplicate-review-max-issues'] || process.env.TASK_SORTER_DUPLICATE_REVIEW_MAX_ISSUES || 250);
    if (!rankedIssues.length) return [];
    if (rankedIssues.length > maxIssues) {
        warnings.push(`Model duplicate review skipped: ${rankedIssues.length} issues exceeds duplicate review limit ${maxIssues}. Deterministic candidate pass still ran.`);
        return [];
    }

    const sourceByKey = new Map(sourceIssues.map((issue) => [issue.key, issue]));
    const compactIssues = rankedIssues.map((issue) => compactIssue(issue, sourceByKey.get(issue.key)));

    try {
        const result = await model
            .withStructuredOutput(DuplicateReviewSchema, { name: 'QinBacklogDuplicateReview', method: 'functionCalling' })
            .invoke(duplicateReviewMessages(exportPayload, compactIssues));
        return result.duplicateGroups || [];
    } catch (err) {
        warnings.push(`Model duplicate review failed: ${truncateText(err?.message || String(err), 500).replace(/\s+/g, ' ')}`);
        return [];
    }
}
