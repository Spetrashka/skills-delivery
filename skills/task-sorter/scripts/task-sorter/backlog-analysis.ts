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

function buildCategoryResult(label, issues, chunkResults) {
    const rankedIssues = buildRankedIssues(issues, chunkResults);
    return { label, rankedIssues, themes: chunkResults.themes || [], groups: buildGroups(rankedIssues) };
}

function categorizeIssues(exportIssues, analysisIssues, reporterFilter, cutoffDate) {
    const reporterPattern = new RegExp(reporterFilter.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    const joshKeys = new Set((exportIssues || []).filter((i) => reporterPattern.test(i.reporter || '')).map((i) => i.key));
    const oldKeys = new Set((exportIssues || []).filter((i) => !joshKeys.has(i.key) && i.created && new Date(i.created) < cutoffDate).map((i) => i.key));
    return {
        josh: analysisIssues.filter((i) => joshKeys.has(i.key)),
        old: analysisIssues.filter((i) => oldKeys.has(i.key)),
        rest: analysisIssues.filter((i) => !joshKeys.has(i.key) && !oldKeys.has(i.key)),
    };
}

async function runWithConcurrency(tasks, concurrency) {
    const results = new Array(tasks.length);
    let next = 0;
    async function worker() {
        while (next < tasks.length) { const i = next++; results[i] = await tasks[i](); }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, worker));
    return results;
}

export async function analyzeBacklog(model, exportPayload, issues, options) {
    const chunkSize = Math.max(1, Number(options['chunk-size'] || process.env.TASK_SORTER_CHUNK_SIZE || 5));
    const concurrency = Math.max(1, Number(options['concurrency'] || process.env.TASK_SORTER_CONCURRENCY || 5));
    const reporterFilter = options['reporter-filter'] || 'Joshua Barron';
    const cutoffDate = new Date('2024-10-01T00:00:00.000Z');
    const warnings = [];

    const categories = categorizeIssues(exportPayload.issues, issues, reporterFilter, cutoffDate);
    console.error(`Categories: ${categories.josh.length} by reporter ("${reporterFilter}"), ${categories.old.length} old (before Oct 2024), ${categories.rest.length} rest.`);

    const categoryKeys = ['josh', 'old', 'rest'] as const;
    const categoryChunks = { josh: chunkItems(categories.josh, chunkSize), old: chunkItems(categories.old, chunkSize), rest: chunkItems(categories.rest, chunkSize) };
    const totalChunks = categoryChunks.josh.length + categoryChunks.old.length + categoryChunks.rest.length;
    console.error(`Processing ${totalChunks} chunks across 3 categories (size ${chunkSize}, concurrency ${concurrency})...`);

    let done = 0;
    const allTasks = categoryKeys.flatMap((catKey) =>
        categoryChunks[catKey].map((chunk, i) => async () => {
            const result = await analyzeChunkWithSplit(model, exportPayload, chunk, warnings);
            done++;
            console.error(`[${catKey}] ${i + 1}/${categoryChunks[catKey].length} done (${done}/${totalChunks} total)`);
            return { catKey, result };
        }),
    );
    const allTaskResults = await runWithConcurrency(allTasks, concurrency);

    const chunkResultsByCategory: Record<string, any[]> = { josh: [], old: [], rest: [] };
    for (const { catKey, result } of allTaskResults) chunkResultsByCategory[catKey].push(result);

    const categoryResults = {
        josh: buildCategoryResult(`Created by ${reporterFilter}`, categories.josh, mergeChunkResults(chunkResultsByCategory.josh)),
        old: buildCategoryResult('Created before October 2024', categories.old, mergeChunkResults(chunkResultsByCategory.old)),
        rest: buildCategoryResult('Other issues', categories.rest, mergeChunkResults(chunkResultsByCategory.rest)),
    };

    const allRankedIssues = [...categoryResults.josh.rankedIssues, ...categoryResults.old.rankedIssues, ...categoryResults.rest.rankedIssues];
    console.error(`Reviewing duplicate candidates across ${allRankedIssues.length} ranked issues...`);
    const crossBacklogDuplicateGroups = await reviewBacklogDuplicates(model, exportPayload, issues, allRankedIssues, warnings, options);

    const allModelDuplicateGroups = [
        ...chunkResultsByCategory.josh.flatMap((r) => r.duplicateGroups || []),
        ...chunkResultsByCategory.old.flatMap((r) => r.duplicateGroups || []),
        ...chunkResultsByCategory.rest.flatMap((r) => r.duplicateGroups || []),
        ...(crossBacklogDuplicateGroups || []),
    ].filter((g) => Array.isArray(g.issueKeys) && g.issueKeys.length > 1).map((g, i) => ({ ...g, groupId: g.groupId || `duplicate-${i + 1}` }));
    const duplicateGroups = mergeDuplicateGroups(allRankedIssues, issues, allModelDuplicateGroups);
    const highPriorityCount = allRankedIssues.filter((i) => i.importance === 'critical' || i.importance === 'high').length;

    const analysis = AnalysisSchema.parse({
        summary: {
            totalIssuesReviewed: issues.length,
            highPriorityCount,
            duplicateGroupCount: duplicateGroups.length,
            overallAssessment: `Reviewed ${issues.length} backlog issues across 3 categories: ${categories.josh.length} by reporter, ${categories.old.length} old (pre-Oct 2024), ${categories.rest.length} rest. ${highPriorityCount} high/critical priority issues.`,
            recommendedNextStep: allRankedIssues[0] ? `Start with ${allRankedIssues[0].key}: ${allRankedIssues[0].suggestedAction}` : 'No issues were available for analysis.',
        },
        duplicateGroups,
        categories: categoryResults,
    });

    return { analysis, warnings, chunkSize };
}
