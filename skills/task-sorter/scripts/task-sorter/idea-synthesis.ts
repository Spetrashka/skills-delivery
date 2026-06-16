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
                'You are a product strategist consolidating an already-ranked Jira backlog into a small set of broad, epic-level Ideas (initiatives).',
                'Merge the provided candidate ideas and the issue list into a deduplicated set of Ideas. Prefer a manageable number of broad epics over many narrow ones — aim for 3-7 total.',
                '',
                'For each Idea write rich, human-readable descriptions that a non-technical stakeholder or engineering manager can act on:',
                '- title: outcome-oriented, 10 words max, understandable without Jira context.',
                '- problemStatement: 2-3 sentences — what user or business pain exists today, why it matters now, and what is at risk if it stays unresolved. Write from a product/customer perspective, not as a list of Jira issue types.',
                '- goal: 2-3 sentences — the concrete measurable outcome when the initiative is delivered, who benefits, what changes for them, and what "done" looks like from a product perspective.',
                '- rationale: 2-3 sentences — why these specific issues belong together as one initiative: shared root cause, same owning team, sequential dependency, or compounding risk if tackled separately.',
                '- notes: any key risks, open decisions, external dependencies, or prerequisite work a planning team must know before committing. Omit if genuinely none.',
                '- importance: derive from the highest importance/score among member issues.',
                '- scopeEstimate: coarse sizing (small / medium / large / x-large) based on count and complexity of related issues.',
                '',
                'For each related issue set role to "core" when the issue is central to delivering the Idea, or "supporting" when it is enabling or adjacent work. Give a one-sentence reason for the role assignment.',
                'An issue may belong to more than one Idea only when genuinely cross-cutting; otherwise pick the single best Idea.',
                'Assign every issue in the list to at least one Idea.',
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
                        'You are merging partial epic-level Ideas produced from separate slices of the same backlog into a final consolidated set.',
                        'Combine Ideas that describe the same broad initiative into a single Idea, unioning their related issues and re-tagging each issue role (core/supporting).',
                        'When merging, rewrite the narrative fields of the merged Idea to be clear and complete — do not just concatenate fragments:',
                        '- title: outcome-oriented, 10 words max.',
                        '- problemStatement: 2-3 sentences from a product/customer perspective covering the full merged scope.',
                        '- goal: 2-3 sentences describing the concrete measurable outcome for all merged issues.',
                        '- rationale: 2-3 sentences explaining why all merged issues belong together.',
                        '- notes: any risks, open decisions, or prerequisites relevant to the merged initiative.',
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
    console.error(`[ideas] Starting synthesis: ${rankedIssues.length} ranked issues, ${dedupedCandidates.length} candidate idea(s) from chunks...`);

    let ideas = null;
    try {
        if (rankedIssues.length <= maxIssues) {
            console.error(`[ideas] Calling model for full backlog (${rankedIssues.length} issues)...`);
            ideas = await synthesizeBatch(model, exportPayload, rankedIssues, sourceByKey, dedupedCandidates);
            console.error(`[ideas] Model returned ${ideas.length} idea(s).`);
        } else {
            const batches = buildBatches(rankedIssues, maxIssues);
            warnings.push(`Idea synthesis split ${rankedIssues.length} issues into ${batches.length} batches (cap ${maxIssues}) and collapsed the results.`);
            console.error(`[ideas] Backlog exceeds cap (${maxIssues}); processing ${batches.length} domain batch(es)...`);
            const partials = [];
            for (let i = 0; i < batches.length; i++) {
                const batch = batches[i];
                const batchKeys = new Set(batch.map((iss) => iss.key));
                const batchCandidates = dedupedCandidates.filter((c) => (c.issueKeys || []).some((k) => batchKeys.has(k)));
                console.error(`[ideas] Batch ${i + 1}/${batches.length}: ${batch.length} issues, ${batchCandidates.length} candidate(s)...`);
                const batchIdeas = await synthesizeBatch(model, exportPayload, batch, sourceByKey, batchCandidates);
                console.error(`[ideas] Batch ${i + 1}/${batches.length} done → ${batchIdeas.length} idea(s).`);
                partials.push(...batchIdeas);
            }
            if (partials.length > 1) {
                console.error(`[ideas] Collapsing ${partials.length} partial idea(s) across batches...`);
                ideas = await collapseIdeas(model, exportPayload, partials, warnings);
                console.error(`[ideas] Collapse done → ${ideas.length} merged idea(s).`);
            } else {
                ideas = partials;
            }
        }
    } catch (err) {
        warnings.push(`Model idea synthesis failed: ${safeErrorMessage(err)}. Used deterministic idea grouping.`);
        console.error(`[ideas] Model call failed (${safeErrorMessage(err)}); falling back to deterministic grouping.`);
        ideas = null;
    }

    if (!ideas || !ideas.length) {
        if (Array.isArray(ideas) && !ideas.length) {
            warnings.push('Model idea synthesis returned no ideas; used deterministic idea grouping.');
            console.error('[ideas] Model returned no ideas; falling back to deterministic grouping.');
        }
        ideas = deterministicIdeas(rankedIssues);
        console.error(`[ideas] Deterministic fallback produced ${ideas.length} idea(s).`);
    }

    console.error(`[ideas] Finalizing coverage for ${rankedIssues.length} ranked issues...`);
    const result = finalizeIdeas(ideas, rankedIssues, knownKeys);
    console.error(`[ideas] Done — ${result.length} idea(s) covering all ranked issues.`);
    return result;
}
