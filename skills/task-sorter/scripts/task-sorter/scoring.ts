export function clampScore(score) {
    return Math.max(0, Math.min(100, Math.round(score)));
}

export function importanceFromScore(score) {
    if (score >= 85) return 'critical';
    if (score >= 70) return 'high';
    if (score >= 35) return 'medium';
    return 'low';
}

export function normalizeModelScore(score) {
    const value = Number(score || 0);
    if (value > 0 && value <= 10) return clampScore(value * 10);
    return clampScore(value);
}

export function actionBucketFromScore(score, fallback = 'groom_first') {
    if (score >= 85) return 'do_now';
    if (score >= 70) return 'schedule_next';
    if (score < 30) return 'defer';
    return fallback;
}

export function alignScoreWithImportance(score, importance) {
    const minimum = { critical: 90, high: 75, medium: 40, low: 0 }[importance] ?? 0;
    return Math.max(score, minimum);
}

export function daysSince(dateValue) {
    const time = Date.parse(dateValue || '');
    if (Number.isNaN(time)) return Infinity;
    return Math.max(0, (Date.now() - time) / 86_400_000);
}

export function heuristicIssueScore(issue) {
    const text = `${issue.title || ''}\n${issue.description || ''}\n${issue.priority || ''}\n${issue.type || ''}`.toLowerCase();
    let score = 25;
    const reasons = [];

    if (/critical|highest|blocker|p0|p1|4:\s*high/.test(text)) {
        score += 25;
        reasons.push('high Jira priority or blocker wording');
    } else if (/medium|problematic|p2|p3|3:\s*medium/.test(text)) {
        score += 12;
        reasons.push('medium Jira priority');
    } else if (/low|trivial|lowest/.test(text)) {
        score -= 5;
        reasons.push('low Jira priority');
    }

    if (/production|prod|outage|incident|support/.test(text)) {
        score += 20;
        reasons.push('production/support impact');
    }
    if (/data loss|missing|corrupt|integrity|migration|consolidation|sync/.test(text)) {
        score += 18;
        reasons.push('data integrity or migration risk');
    }
    if (/security|privacy|pii|compliance|audit/.test(text)) {
        score += 18;
        reasons.push('security/compliance signal');
    }
    if (/block|dependency|unblock|release|onboarding|customer|client|partner/.test(text)) {
        score += 12;
        reasons.push('dependency, release, or customer signal');
    }
    if (/metrics|prometheus|grafana|alert|monitor|observability|incident management/.test(text)) {
        score += 10;
        reasons.push('operational visibility signal');
    }
    if (/bug|failure|failed|error|fix/.test(text)) {
        score += 10;
        reasons.push('bug/failure signal');
    }
    if (/epic|capability|strategy/.test(String(issue.type || '').toLowerCase())) {
        score += 8;
        reasons.push('large initiative type');
    }
    if (String(issue.statusCategory || '').toLowerCase() === 'in progress') {
        score += 6;
        reasons.push('already in progress');
    }

    const age = daysSince(issue.updated);
    if (age <= 14) {
        score += 8;
        reasons.push('recently updated');
    } else if (age > 90) {
        score -= 8;
        reasons.push('stale update date');
    }

    return { score: clampScore(score), reasons };
}
