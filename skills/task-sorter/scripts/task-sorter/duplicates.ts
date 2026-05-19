import { daysSince } from './scoring.ts';

const DUPLICATE_STOPWORDS = new Set([
    'and', 'are', 'for', 'from', 'have', 'into', 'not', 'that', 'the', 'this', 'with',
    'about', 'after', 'before', 'when', 'where', 'which', 'will', 'task', 'issue',
    'story', 'need', 'needs', 'create', 'update', 'add', 'fix', 'able', 'should',
]);

function duplicateTokens(issue, sourceIssue) {
    const text = [
        issue.key, issue.title, sourceIssue?.title, sourceIssue?.description,
        issue.productDomain, issue.taskKind, ...(issue.systems || []), ...(issue.projectThemes || []),
    ].join(' ').toLowerCase();
    return new Set((text.match(/[a-z0-9][a-z0-9_-]{2,}/g) || [])
        .filter((t) => !DUPLICATE_STOPWORDS.has(t)).slice(0, 180));
}

function setIntersectionSize(left, right) {
    let count = 0;
    for (const item of left) { if (right.has(item)) count += 1; }
    return count;
}

function sharedValues(left = [], right = []) {
    const rightSet = new Set(right.map((v) => String(v).toLowerCase()));
    return left.filter((v) => rightSet.has(String(v).toLowerCase()));
}

function normalizeTitle(value) {
    return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function duplicateConfidenceWeight(confidence) {
    return { high: 3, medium: 2, low: 1 }[confidence] || 0;
}

function duplicateCandidate(left, right, sourceByKey) {
    const leftSource = sourceByKey.get(left.key);
    const rightSource = sourceByKey.get(right.key);
    const leftTokens = duplicateTokens(left, leftSource);
    const rightTokens = duplicateTokens(right, rightSource);
    const overlap = setIntersectionSize(leftTokens, rightTokens);
    const unionSize = new Set([...leftTokens, ...rightTokens]).size || 1;
    const tokenScore = overlap / unionSize;
    const commonSystems = sharedValues(left.systems, right.systems);
    const commonThemes = sharedValues(left.projectThemes, right.projectThemes);
    const titleLeft = normalizeTitle(left.title || leftSource?.title);
    const titleRight = normalizeTitle(right.title || rightSource?.title);
    const titleMatch = Boolean(titleLeft && titleRight && (titleLeft.includes(titleRight) || titleRight.includes(titleLeft)));
    const sameDomain = left.productDomain !== 'unknown' && left.productDomain === right.productDomain;
    const sameKind = left.taskKind !== 'unknown' && left.taskKind === right.taskKind;
    const strongContext = commonThemes.length > 0 && (sameDomain || sameKind);

    if (!titleMatch && tokenScore < 0.2 && !(strongContext && tokenScore >= 0.15)) return null;

    let score = tokenScore;
    if (sameDomain) score += 0.12;
    if (sameKind) score += 0.08;
    if (commonSystems.length) score += Math.min(0.18, commonSystems.length * 0.09);
    if (commonThemes.length) score += Math.min(0.16, commonThemes.length * 0.08);
    if (titleMatch) score += 0.12;
    if (score < 0.62) return null;

    const confidence = score >= 0.75 ? 'high' : score >= 0.64 ? 'medium' : 'low';
    const reasons = [
        `semantic overlap ${Math.round(tokenScore * 100)}%`,
        sameDomain ? `same domain ${left.productDomain}` : '',
        sameKind ? `same kind ${left.taskKind}` : '',
        commonSystems.length ? `shared systems ${commonSystems.join(', ')}` : '',
        commonThemes.length ? `shared themes ${commonThemes.join(', ')}` : '',
    ].filter(Boolean);

    return { leftKey: left.key, rightKey: right.key, confidence, score, reason: reasons.join('; ') };
}

export function mergeDuplicateGroups(rankedIssues, sourceIssues, modelGroups) {
    const issueByKey = new Map(rankedIssues.map((issue) => [issue.key, issue]));
    const sourceByKey = new Map(sourceIssues.map((issue) => [issue.key, issue]));
    const edges = [];

    for (const group of modelGroups || []) {
        const keys = [...new Set((group.issueKeys || []).filter((key) => issueByKey.has(key)))];
        if (keys.length < 2) continue;
        for (let i = 0; i < keys.length; i += 1) {
            for (let j = i + 1; j < keys.length; j += 1) {
                edges.push({
                    leftKey: keys[i], rightKey: keys[j],
                    confidence: group.confidence || 'low',
                    score: duplicateConfidenceWeight(group.confidence || 'low') / 3,
                    reason: group.reason || 'Model marked these issues as overlapping within a chunk.',
                });
            }
        }
    }

    for (let i = 0; i < rankedIssues.length; i += 1) {
        for (let j = i + 1; j < rankedIssues.length; j += 1) {
            const candidate = duplicateCandidate(rankedIssues[i], rankedIssues[j], sourceByKey);
            if (candidate) edges.push(candidate);
        }
    }

    if (!edges.length) return [];

    const parent = new Map(rankedIssues.map((issue) => [issue.key, issue.key]));
    const find = (key) => { const root = parent.get(key); if (root === key) return key; const next = find(root); parent.set(key, next); return next; };
    const union = (lk, rk) => { const lr = find(lk); const rr = find(rk); if (lr !== rr) parent.set(rr, lr); };
    for (const edge of edges) union(edge.leftKey, edge.rightKey);

    const groupedKeys = new Map();
    for (const issue of rankedIssues) {
        const root = find(issue.key);
        if (!groupedKeys.has(root)) groupedKeys.set(root, []);
        groupedKeys.get(root).push(issue.key);
    }

    const groups = [];
    for (const keys of groupedKeys.values()) {
        if (keys.length < 2) continue;
        const groupEdges = edges.filter((e) => keys.includes(e.leftKey) && keys.includes(e.rightKey));
        const bestEdge = groupEdges.sort((a, b) => b.score - a.score)[0];
        const canonical = keys.map((k) => issueByKey.get(k)).sort((a, b) => a.rank - b.rank || b.score - a.score)[0];
        const confidence = groupEdges.reduce(
            (best, e) => duplicateConfidenceWeight(e.confidence) > duplicateConfidenceWeight(best) ? e.confidence : best, 'low',
        );
        for (const key of keys) {
            if (key === canonical.key) continue;
            const issue = issueByKey.get(key);
            issue.possibleDuplicateOf = canonical.key;
            issue.duplicateConfidence = confidence;
            issue.duplicateReason = bestEdge?.reason || 'Possible duplicate found in final cross-backlog duplicate pass.';
            issue.actionBucket = 'deduplicate';
        }
        groups.push({
            groupId: `possible-duplicate-${groups.length + 1}`,
            issueKeys: keys.sort((a, b) => issueByKey.get(a).rank - issueByKey.get(b).rank),
            confidence,
            reason: bestEdge?.reason || 'Possible duplicate found in final cross-backlog duplicate pass.',
            recommendedCanonicalKey: canonical.key,
        });
    }
    return groups;
}
