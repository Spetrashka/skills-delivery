import { ChunkAnalysisSchema } from './schemas.ts';
import { heuristicIssueScore, importanceFromScore } from './scoring.ts';
import { ACTION_BUCKETS, PLANNING_CATEGORIES, PRODUCT_DOMAINS, TASK_KINDS, TAXONOMY_GUIDE, WORK_AREAS } from './taxonomy.ts';

export function truncateText(text, maxChars) {
    const value = String(text || '');
    if (!maxChars || value.length <= maxChars) return value;
    return `${value.slice(0, maxChars)}\n\n[truncated ${value.length - maxChars} chars]`;
}

export function chunkItems(items, chunkSize) {
    const chunks = [];
    for (let i = 0; i < items.length; i += chunkSize) chunks.push(items.slice(i, i + chunkSize));
    return chunks;
}

function safeErrorMessage(err) {
    return truncateText(err?.message || String(err), 500).replace(/\s+/g, ' ');
}

function isNonRecoverableModelError(err) {
    const message = safeErrorMessage(err).toLowerCase();
    return [
        'personal access tokens are not supported',
        'invalid api key',
        'incorrect api key',
        'unauthorized',
        'authentication',
        'permission_denied',
        'forbidden',
    ].some((signal) => message.includes(signal));
}

export function fallbackIssueAnalysis(issue, reason = 'Model could not return valid structured output for this issue.') {
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
        workArea: 'unknown',
        productDomain: 'unknown',
        taskKind: 'unknown',
        planningCategory: 'improvement',
        systems: [],
        projectThemes: [],
        actionBucket: heuristic.score >= 85
            ? 'do_now'
            : heuristic.score >= 70
                ? 'schedule_next'
                : 'groom_first',
    };
}

export function analysisMessages(exportPayload, issues) {
    return [
        {
            role: 'system',
            content: [
                'You are a backlog triage analyst.',
                'Analyze only the provided Jira export. Do not suggest or claim Jira mutations.',
                'Analyze this chunk only. Rank issues by practical importance: user/customer impact, blockers, revenue, compliance/security risk, dependency unblocking, severity, freshness, and clarity.',
                'Classify each issue yourself from its title, description, Jira metadata, labels, components, and parent/sprint context. Do not rely on keyword-only matching.',
                TAXONOMY_GUIDE,
                `For every ranked issue, choose one workArea from: ${WORK_AREAS.join(', ')}.`,
                `For every ranked issue, choose one productDomain from: ${PRODUCT_DOMAINS.join(', ')}.`,
                `For every ranked issue, choose one taskKind from: ${TASK_KINDS.join(', ')}.`,
                `For every ranked issue, choose one planningCategory from: ${PLANNING_CATEGORIES.join(', ')}.`,
                `For every ranked issue, choose one actionBucket from: ${ACTION_BUCKETS.join(', ')}.`,
                'Populate systems and projectThemes from the issue context using concise product/system names. Leave them empty only when there is no reliable signal.',
                'Detect duplicates and overlapping tasks conservatively. Use low confidence when evidence is weak.',
                'Return every reviewed issue in rankedIssues exactly once unless the input is empty.',
                'Do not include hidden reasoning, chain of thought, markdown, or prose outside the structured response.',
            ].join('\n'),
        },
        { role: 'user', content: JSON.stringify({ source: exportPayload.source, issues }) },
    ];
}

export async function invokeChunkAnalysisModel(model, exportPayload, issues) {
    return model
        .withStructuredOutput(ChunkAnalysisSchema, { name: 'QinBacklogChunkAnalysis', method: 'functionCalling' })
        .invoke(analysisMessages(exportPayload, issues));
}

export function importanceWeight(importance) {
    return { critical: 4, high: 3, medium: 2, low: 1 }[importance] || 0;
}

export function mergeThemes(themes) {
    const byName = new Map();
    for (const theme of themes || []) {
        const key = String(theme.name || 'Untitled theme').toLowerCase();
        const existing = byName.get(key);
        if (!existing) {
            byName.set(key, { name: theme.name || 'Untitled theme', issueKeys: [...new Set(theme.issueKeys || [])], importance: theme.importance || 'medium', notes: theme.notes || '' });
            continue;
        }
        existing.issueKeys = [...new Set([...existing.issueKeys, ...(theme.issueKeys || [])])];
        if (importanceWeight(theme.importance) > importanceWeight(existing.importance)) existing.importance = theme.importance;
        if (!existing.notes && theme.notes) existing.notes = theme.notes;
    }
    return [...byName.values()];
}

export function mergeChunkResults(results) {
    return {
        rankedIssues: results.flatMap((r) => r.rankedIssues || []),
        duplicateGroups: results.flatMap((r) => r.duplicateGroups || []),
        themes: mergeThemes(results.flatMap((r) => r.themes || [])),
    };
}

export async function analyzeChunkWithSplit(model, exportPayload, issues, warnings) {
    try {
        const result = await invokeChunkAnalysisModel(model, exportPayload, issues);
        const returnedKeys = new Set((result.rankedIssues || []).map((i) => i.key));
        const missing = issues
            .filter((i) => !returnedKeys.has(i.key))
            .map((i) => fallbackIssueAnalysis(i, 'Model omitted this issue from the structured chunk output.'));
        return {
            rankedIssues: [...(result.rankedIssues || []), ...missing],
            duplicateGroups: result.duplicateGroups || [],
            themes: result.themes || [],
        };
    } catch (err) {
        if (isNonRecoverableModelError(err)) throw err;
        if (issues.length <= 1) {
            warnings.push(`Fallback used for ${issues[0]?.key}: ${safeErrorMessage(err)}`);
            return { rankedIssues: [fallbackIssueAnalysis(issues[0], safeErrorMessage(err))], duplicateGroups: [], themes: [] };
        }
        warnings.push(`Chunk of ${issues.length} issues failed structured parsing; splitting into smaller chunks.`);
        const middle = Math.ceil(issues.length / 2);
        const left = await analyzeChunkWithSplit(model, exportPayload, issues.slice(0, middle), warnings);
        const right = await analyzeChunkWithSplit(model, exportPayload, issues.slice(middle), warnings);
        return mergeChunkResults([left, right]);
    }
}
