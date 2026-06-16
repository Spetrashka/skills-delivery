import { IdeaSynthesisSchema } from './schemas.ts';
import { truncateText, importanceWeight } from './chunk-analysis.ts';

const IMPORTANCE_BY_WEIGHT = { 4: 'critical', 3: 'high', 2: 'medium', 1: 'low', 0: 'low' };

function safeErrorMessage(err) {
    return truncateText(err?.message || String(err), 500).replace(/\s+/g, ' ');
}

function compactIssue(issue, sourceIssue) {
    return {
        key: issue.key,
        title: issue.title || sourceIssue?.title || issue.key,
        description: truncateText(sourceIssue?.description, 500),
        importance: issue.importance,
        score: issue.score,
        productDomain: issue.productDomain,
        taskKind: issue.taskKind,
        planningCategory: issue.planningCategory,
        systems: issue.systems || [],
        projectThemes: issue.projectThemes || [],
    };
}

// Merge raw per-chunk candidate ideas by title so the synthesis prompt stays compact.
function dedupeCandidateIdeas(candidateIdeas) {
    const byTitle = new Map();
    for (const candidate of candidateIdeas || []) {
        const key = String(candidate?.title || '').trim().toLowerCase();
        if (!key) continue;
        const existing = byTitle.get(key);
        if (!existing) {
            byTitle.set(key, {
                title: candidate.title,
                problemStatement: candidate.problemStatement || '',
                goal: candidate.goal || '',
                productDomain: candidate.productDomain || 'unknown',
                issueKeys: [...new Set(candidate.issueKeys || [])],
            });
            continue;
        }
        existing.issueKeys = [...new Set([...existing.issueKeys, ...(candidate.issueKeys || [])])];
        if (!existing.problemStatement && candidate.problemStatement) existing.problemStatement = candidate.problemStatement;
        if (!existing.goal && candidate.goal) existing.goal = candidate.goal;
    }
    return [...byTitle.values()];
}

function ideaSynthesisMessages(exportPayload, compactIssues, candidateIdeas) {
    return [
        {
            role: 'system',
            content: [
                'You are consolidating an already-ranked Jira backlog into a small set of broad, epic-level Ideas (initiatives).',
                'Merge the provided candidate ideas and the issue list into a deduplicated set of Ideas. Prefer a manageable number of broad epics over many narrow ones.',
                'For each Idea provide: a clear title, problemStatement, goal/outcome, rationale, importance (derived from the importance and score of its member issues), and scopeEstimate (coarse epic sizing from the count and complexity of related issues).',
                'Assign every issue in the list to at least one Idea. For each related issue set role to "core" when the issue is central to delivering the Idea, or "supporting" when it is enabling or adjacent work, and give a short reason.',
                'An issue may belong to more than one Idea only when genuinely cross-cutting; otherwise pick the single best Idea.',
                'Use issue keys exactly as provided. Do not invent keys. Do not include prose outside the structured response.',
            ].join('\n'),
        },
        { role: 'user', content: JSON.stringify({ source: exportPayload.source, candidateIdeas, issues: compactIssues }) },
    ];
}

async function synthesizeBatch(model, exportPayload, rankedIssues, sourceByKey, candidateIdeas) {
    const compactIssues = rankedIssues.map((issue) => compactIssue(issue, sourceByKey.get(issue.key)));
    const result = await model
        .withStructuredOutput(IdeaSynthesisSchema, { name: 'QinBacklogIdeaSynthesis', method: 'functionCalling' })
        .invoke(ideaSynthesisMessages(exportPayload, compactIssues, candidateIdeas));
    return result.ideas || [];
}

function chunkBySize(items, size) {
    const chunks = [];
    for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
    return chunks;
}

// Build batches grouped by product domain so each synthesis call stays coherent and within the cap.
function buildBatches(rankedIssues, maxIssues) {
    const byDomain = new Map();
    for (const issue of rankedIssues) {
        const domain = issue.productDomain || 'unknown';
        if (!byDomain.has(domain)) byDomain.set(domain, []);
        byDomain.get(domain).push(issue);
    }
    const batches = [];
    let current = [];
    for (const group of byDomain.values()) {
        if (group.length > maxIssues) {
            if (current.length) { batches.push(current); current = []; }
            batches.push(...chunkBySize(group, maxIssues));
            continue;
        }
        if (current.length + group.length > maxIssues) { batches.push(current); current = []; }
        current.push(...group);
    }
    if (current.length) batches.push(current);
    return batches;
}

// Collapse partial idea sets from multiple batches into a merged set (classic map-reduce collapse).
async function collapseIdeas(model, exportPayload, partialIdeas, warnings) {
    const summaries = partialIdeas.map((idea) => ({
        title: idea.title,
        problemStatement: idea.problemStatement || '',
        goal: idea.goal || '',
        productDomain: idea.productDomain || 'unknown',
        importance: idea.importance || 'medium',
        scopeEstimate: idea.scopeEstimate || 'medium',
        relatedIssues: (idea.relatedIssues || []).map((r) => ({ key: r.key, role: r.role || 'supporting' })),
    }));
    try {
        const result = await model
            .withStructuredOutput(IdeaSynthesisSchema, { name: 'QinBacklogIdeaCollapse', method: 'functionCalling' })
            .invoke([
                {
                    role: 'system',
                    content: [
                        'You are merging partial epic-level Ideas produced from separate slices of the same backlog.',
                        'Combine Ideas that describe the same broad initiative into a single Idea, unioning their related issues and re-tagging each issue role (core/supporting).',
                        'Keep distinct initiatives separate. Preserve every issue key from the input across the merged Ideas. Do not invent keys or add prose outside the structured response.',
                    ].join('\n'),
                },
                { role: 'user', content: JSON.stringify({ source: exportPayload.source, ideas: summaries }) },
            ]);
        return result.ideas || [];
    } catch (err) {
        warnings.push(`Idea collapse step failed: ${safeErrorMessage(err)}. Kept per-batch ideas without cross-batch merge.`);
        return partialIdeas;
    }
}

function humanizeDomain(domain) {
    if (!domain || domain === 'unknown') return 'Uncategorized backlog';
    return domain.split('_').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
}

function maxImportance(issues) {
    const weight = Math.max(0, ...issues.map((i) => importanceWeight(i.importance)));
    return IMPORTANCE_BY_WEIGHT[weight] || 'medium';
}

function scopeFromCount(count) {
    if (count <= 3) return 'small';
    if (count <= 8) return 'medium';
    if (count <= 20) return 'large';
    return 'x-large';
}

// Deterministic fallback: group ranked issues into broad product-domain epics when the model is unavailable.
function deterministicIdeas(rankedIssues) {
    const byDomain = new Map();
    for (const issue of rankedIssues) {
        const domain = issue.productDomain || 'unknown';
        if (!byDomain.has(domain)) byDomain.set(domain, []);
        byDomain.get(domain).push(issue);
    }
    const ideas = [];
    for (const [domain, issues] of byDomain.entries()) {
        const sorted = [...issues].sort((a, b) => (b.score || 0) - (a.score || 0));
        const name = humanizeDomain(domain);
        ideas.push({
            title: `${name} initiative`,
            problemStatement: `Consolidate ${issues.length} related backlog item${issues.length === 1 ? '' : 's'} in ${name.toLowerCase()}.`,
            goal: `Plan and deliver the ${name.toLowerCase()} work as one coordinated initiative.`,
            rationale: 'Grouped deterministically by product domain because model-based idea synthesis was unavailable.',
            importance: maxImportance(issues),
            scopeEstimate: scopeFromCount(issues.length),
            productDomain: domain,
            relatedIssues: sorted.map((issue, index) => ({
                key: issue.key,
                role: index === 0 || ['critical', 'high'].includes(issue.importance) ? 'core' : 'supporting',
                reason: '',
            })),
            notes: '',
        });
    }
    return ideas;
}

// Assign ids, drop unknown keys, dedupe issues per idea, and guarantee every ranked issue is assigned.
function finalizeIdeas(ideas, rankedIssues, knownKeys) {
    const issueByKey = new Map(rankedIssues.map((i) => [i.key, i]));
    const cleaned = (ideas || [])
        .map((idea, index) => {
            const seen = new Map();
            for (const related of idea.relatedIssues || []) {
                if (!knownKeys.has(related.key)) continue;
                const role = related.role === 'core' ? 'core' : 'supporting';
                const existing = seen.get(related.key);
                // Prefer a core tag if any source marked the issue as core.
                if (!existing || (existing.role !== 'core' && role === 'core')) {
                    seen.set(related.key, { key: related.key, role, reason: related.reason || '' });
                }
            }
            return {
                id: idea.id || `idea-${index + 1}`,
                title: idea.title || `Idea ${index + 1}`,
                problemStatement: idea.problemStatement || '',
                goal: idea.goal || '',
                rationale: idea.rationale || '',
                importance: idea.importance || 'medium',
                scopeEstimate: idea.scopeEstimate || 'medium',
                productDomain: idea.productDomain || 'unknown',
                relatedIssues: [...seen.values()],
                notes: idea.notes || '',
            };
        })
        .filter((idea) => idea.relatedIssues.length);

    // Coverage: force-assign any uncovered ranked issue to the best domain-matching idea (or a catch-all).
    const covered = new Set(cleaned.flatMap((idea) => idea.relatedIssues.map((r) => r.key)));
    const uncovered = rankedIssues.filter((issue) => !covered.has(issue.key));
    if (uncovered.length) {
        const ideaByDomain = new Map();
        for (const idea of cleaned) if (!ideaByDomain.has(idea.productDomain)) ideaByDomain.set(idea.productDomain, idea);
        const leftovers = [];
        for (const issue of uncovered) {
            const target = ideaByDomain.get(issue.productDomain);
            if (target) target.relatedIssues.push({ key: issue.key, role: 'supporting', reason: 'Auto-assigned to nearest domain idea for full coverage.' });
            else leftovers.push(issue);
        }
        if (leftovers.length) {
            cleaned.push({
                id: `idea-${cleaned.length + 1}`,
                title: 'Unassigned backlog items',
                problemStatement: `${leftovers.length} ranked item${leftovers.length === 1 ? '' : 's'} did not map to a synthesized idea.`,
                goal: 'Review and route these items into an initiative during grooming.',
                rationale: 'Catch-all to guarantee every ranked issue is represented in an idea.',
                importance: maxImportance(leftovers),
                scopeEstimate: scopeFromCount(leftovers.length),
                productDomain: 'unknown',
                relatedIssues: leftovers.map((issue) => ({ key: issue.key, role: 'supporting', reason: '' })),
                notes: '',
            });
        }
    }

    return cleaned.map((idea, index) => ({ ...idea, id: `idea-${index + 1}` }));
}

export async function synthesizeIdeas(model, exportPayload, sourceIssues, rankedIssues, candidateIdeas, warnings, options) {
    if (!rankedIssues.length) return [];
    const maxIssues = Number(options['idea-synthesis-max-issues'] || process.env.TASK_SORTER_IDEA_SYNTHESIS_MAX_ISSUES || 250);
    const knownKeys = new Set(rankedIssues.map((i) => i.key));
    const sourceByKey = new Map(sourceIssues.map((issue) => [issue.key, issue]));
    const dedupedCandidates = dedupeCandidateIdeas(candidateIdeas);

    let ideas = null;
    try {
        if (rankedIssues.length <= maxIssues) {
            ideas = await synthesizeBatch(model, exportPayload, rankedIssues, sourceByKey, dedupedCandidates);
        } else {
            const batches = buildBatches(rankedIssues, maxIssues);
            warnings.push(`Idea synthesis split ${rankedIssues.length} issues into ${batches.length} batches (cap ${maxIssues}) and collapsed the results.`);
            const partials = [];
            for (const batch of batches) {
                const batchKeys = new Set(batch.map((i) => i.key));
                const batchCandidates = dedupedCandidates.filter((c) => (c.issueKeys || []).some((k) => batchKeys.has(k)));
                partials.push(...(await synthesizeBatch(model, exportPayload, batch, sourceByKey, batchCandidates)));
            }
            ideas = partials.length > 1 ? await collapseIdeas(model, exportPayload, partials, warnings) : partials;
        }
    } catch (err) {
        warnings.push(`Model idea synthesis failed: ${safeErrorMessage(err)}. Used deterministic idea grouping.`);
        ideas = null;
    }

    if (!ideas || !ideas.length) {
        if (Array.isArray(ideas) && !ideas.length) warnings.push('Model idea synthesis returned no ideas; used deterministic idea grouping.');
        ideas = deterministicIdeas(rankedIssues);
    }

    return finalizeIdeas(ideas, rankedIssues, knownKeys);
}
