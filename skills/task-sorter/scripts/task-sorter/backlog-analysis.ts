import { AnalysisSchema } from './schemas.ts';
import { normalizeModelScore, alignScoreWithImportance } from './scoring.ts';
import { mergeDuplicateGroups } from './duplicates.ts';
import { truncateText, chunkItems, fallbackIssueAnalysis, importanceWeight, mergeChunkResults, analyzeChunkWithSplit } from './chunk-analysis.ts';
import { reviewBacklogDuplicates } from './duplicate-review.ts';

export function toAnalysisInput(exportPayload, options) {
    const issues = options['max-analyze-issues'] ? exportPayload.issues.slice(0, Number(options['max-analyze-issues'])) : exportPayload.issues;
    const maxDescriptionChars = Number(options['max-description-chars'] || process.env.TASK_SORTER_MAX_DESCRIPTION_CHARS || 2500);
    return issues.map((issue) => ({
        key: issue.key,
        title: issue.summary,
        description: truncateText(issue.description, maxDescriptionChars),
        status: issue.status,
        statusCategory: issue.statusCategory,
        type: issue.type,
        priority: issue.priority,
        assignee: issue.assignee,
        updated: issue.updated,
        labels: issue.labels,
        components: issue.components,
        parent: issue.parent,
        sprintNames: issue.sprintNames,
        storyPoints: issue.storyPoints,
    }));
}

function addGroup(groups, groupName, key, issueKey) {
    if (!key) return;
    if (!groups[groupName][key]) groups[groupName][key] = [];
    if (!groups[groupName][key].includes(issueKey)) groups[groupName][key].push(issueKey);
}

function buildGroups(rankedIssues) {
    const groups = { byWorkArea: {}, byProductDomain: {}, byTaskKind: {}, byActionBucket: {}, byProjectTheme: {}, bySystem: {} };
    for (const issue of rankedIssues) {
        addGroup(groups, 'byWorkArea', issue.workArea, issue.key);
        addGroup(groups, 'byProductDomain', issue.productDomain, issue.key);
        addGroup(groups, 'byTaskKind', issue.taskKind, issue.key);
        addGroup(groups, 'byActionBucket', issue.actionBucket, issue.key);
        for (const theme of issue.projectThemes || []) addGroup(groups, 'byProjectTheme', theme, issue.key);
        for (const system of issue.systems || []) addGroup(groups, 'bySystem', system, issue.key);
    }
    return groups;
}

export function buildRankedIssues(issues, chunkResults) {
    const issueByKey = new Map(issues.map((i) => [i.key, i]));
    const rankedByKey = new Map();

    for (const issue of chunkResults.rankedIssues || []) {
        if (!issue?.key || rankedByKey.has(issue.key)) continue;
        rankedByKey.set(issue.key, issue);
    }
    for (const issue of issues) {
        if (!rankedByKey.has(issue.key)) rankedByKey.set(issue.key, fallbackIssueAnalysis(issue, 'Issue was missing after chunk merge.'));
    }

    const rankedIssues = [...rankedByKey.values()]
        .map((issue) => ({
            ...issue,
            title: issue.title || issueByKey.get(issue.key)?.title || issue.key,
            score: alignScoreWithImportance(normalizeModelScore(issue.score || 50), issue.importance),
        }))
        .sort((a, b) => {
            const d = b.score - a.score;
            return d || importanceWeight(b.importance) - importanceWeight(a.importance);
        })
        .map((issue, index) => {
            return {
                ...issue,
                systems: issue.systems || [],
                projectThemes: issue.projectThemes || [],
                possibleDuplicateOf: issue.possibleDuplicateOf || null,
                duplicateConfidence: issue.duplicateConfidence || null,
                duplicateReason: issue.duplicateReason || '',
                rank: index + 1,
            };
        });
    return rankedIssues;
}

export function buildFinalAnalysis(issues, chunkResults, extraDuplicateGroups = []) {
    const rankedIssues = buildRankedIssues(issues, chunkResults);

    const modelDuplicateGroups = [...(chunkResults.duplicateGroups || []), ...(extraDuplicateGroups || [])]
        .filter((g) => Array.isArray(g.issueKeys) && g.issueKeys.length > 1)
        .map((g, i) => ({ ...g, groupId: g.groupId || `duplicate-${i + 1}` }));
    const duplicateGroups = mergeDuplicateGroups(rankedIssues, issues, modelDuplicateGroups);
    const highPriorityCount = rankedIssues.filter((i) => i.importance === 'critical' || i.importance === 'high').length;

    return AnalysisSchema.parse({
        summary: {
            totalIssuesReviewed: issues.length,
            highPriorityCount,
            duplicateGroupCount: duplicateGroups.length,
            overallAssessment: `Reviewed ${issues.length} backlog issues in structured chunks. ${highPriorityCount} issues were classified as high or critical priority.`,
            recommendedNextStep: rankedIssues[0]
                ? `Start with ${rankedIssues[0].key}: ${rankedIssues[0].suggestedAction}`
                : 'No issues were available for analysis.',
        },
        rankedIssues,
        duplicateGroups,
        themes: chunkResults.themes || [],
        groups: buildGroups(rankedIssues),
    });
}

export async function analyzeBacklog(model, exportPayload, issues, options) {
    const chunkSize = Math.max(1, Number(options['chunk-size'] || process.env.TASK_SORTER_CHUNK_SIZE || 5));
    const warnings = [];
    const chunks = chunkItems(issues, chunkSize);
    const results = [];
    for (const [index, chunk] of chunks.entries()) {
        console.error(`Analyzing chunk ${index + 1}/${chunks.length} (${chunk.length} issues)...`);
        results.push(await analyzeChunkWithSplit(model, exportPayload, chunk, warnings));
    }
    const mergedResults = mergeChunkResults(results);
    const rankedIssues = buildRankedIssues(issues, mergedResults);
    console.error(`Reviewing duplicate candidates across ${rankedIssues.length} ranked issues with the model...`);
    const crossBacklogDuplicateGroups = await reviewBacklogDuplicates(model, exportPayload, issues, rankedIssues, warnings, options);
    return { analysis: buildFinalAnalysis(issues, mergedResults, crossBacklogDuplicateGroups), warnings, chunkSize };
}
