import { z } from 'zod';
import { ACTION_BUCKETS, PLANNING_CATEGORIES, PRODUCT_DOMAINS, TASK_KINDS, WORK_AREAS } from './taxonomy.ts';

export const WorkAreaSchema = z.enum(WORK_AREAS);
export const ProductDomainSchema = z.enum(PRODUCT_DOMAINS);
export const TaskKindSchema = z.enum(TASK_KINDS);
export const ActionBucketSchema = z.enum(ACTION_BUCKETS);
export const PlanningCategorySchema = z.enum(PLANNING_CATEGORIES);

const RankedIssueItemSchema = z.object({
    rank: z.number(),
    key: z.string(),
    title: z.string(),
    importance: z.enum(['critical', 'high', 'medium', 'low']),
    confidence: z.enum(['high', 'medium', 'low']),
    score: z.number().min(0).max(100),
    reasoning: z.string(),
    suggestedAction: z.string(),
    riskIfDelayed: z.string(),
    duplicateOf: z.string().nullable().default(null),
    possibleDuplicateOf: z.string().nullable().default(null),
    duplicateConfidence: z.enum(['high', 'medium', 'low']).nullable().default(null),
    duplicateReason: z.string().default(''),
    workArea: WorkAreaSchema.describe('Best engineering/work ownership category for this issue.').default('unknown'),
    productDomain: ProductDomainSchema.describe('Best product or business domain for this issue.').default('unknown'),
    taskKind: TaskKindSchema.describe('Best type of task this issue represents.').default('unknown'),
    planningCategory: PlanningCategorySchema.describe('Backlog planning split: planned/new feature, improvement to existing implementation, or bug.').default('improvement'),
    systems: z.array(z.string()).describe('Concrete systems, integrations, applications, services, or partner names involved.').default([]),
    projectThemes: z.array(z.string()).describe('Short human-readable themes that group related work across issues.').default([]),
    actionBucket: ActionBucketSchema.describe('Practical queue for backlog cleanup and planning.').default('groom_first'),
});

const DuplicateGroupItemSchema = z.object({
    groupId: z.string(),
    issueKeys: z.array(z.string()),
    confidence: z.enum(['high', 'medium', 'low']),
    reason: z.string(),
    recommendedCanonicalKey: z.string(),
});

const ThemeItemSchema = z.object({
    name: z.string(),
    issueKeys: z.array(z.string()).default([]),
    importance: z.enum(['critical', 'high', 'medium', 'low']).default('medium'),
    notes: z.string().default(''),
});

const IdeaRole = z.enum(['core', 'supporting']);
const IdeaScope = z.enum(['small', 'medium', 'large', 'x-large']);

const RelatedIssueSchema = z.object({
    key: z.string(),
    role: IdeaRole.describe('Whether the issue is central (core) to delivering the idea or enabling/related (supporting).').default('supporting'),
    reason: z.string().default(''),
});

// Lightweight candidate idea emitted per chunk during the map stage. A single chunk only
// sees a few issues, so it cannot judge global importance/scope or the full related set.
export const CandidateIdeaSchema = z.object({
    title: z.string(),
    problemStatement: z.string().default(''),
    goal: z.string().default(''),
    issueKeys: z.array(z.string()).describe('Issue keys from this chunk that roll up into the idea.').default([]),
    productDomain: ProductDomainSchema.default('unknown'),
});

// Final, consolidated, global epic-level idea produced by the reduce/synthesis stage.
export const IdeaItemSchema = z.object({
    id: z.string().default(''),
    title: z.string().describe('Outcome-oriented initiative title a non-technical stakeholder would understand. 10 words max.'),
    problemStatement: z.string().describe('2-3 sentences: what user/business pain or gap exists today, why it matters, and what is at risk if it stays unresolved. Write from a product or customer perspective, not as a list of issue types.').default(''),
    goal: z.string().describe('2-3 sentences: the concrete, measurable outcome when this initiative is delivered — who benefits, what changes for them, and what "done" looks like.').default(''),
    rationale: z.string().describe('2-3 sentences: why these specific issues belong together as one initiative — shared root cause, same owning team, sequential dependency, or compounding risk if tackled separately.').default(''),
    importance: z.enum(['critical', 'high', 'medium', 'low']).default('medium'),
    scopeEstimate: IdeaScope.describe('Coarse epic-level sizing derived from the count and complexity of related issues.').default('medium'),
    relatedIssues: z.array(RelatedIssueSchema).default([]),
    productDomain: ProductDomainSchema.default('unknown'),
    notes: z.string().describe('Optional: key risks, open decisions, external dependencies, or prerequisite work a planning team needs to know before committing to this initiative. Leave empty if none.').default(''),
});

const GroupsSchema = z.object({
    byWorkArea: z.record(z.array(z.string())).default({}),
    byProductDomain: z.record(z.array(z.string())).default({}),
    byTaskKind: z.record(z.array(z.string())).default({}),
    byPlanningCategory: z.record(z.array(z.string())).default({}),
    byActionBucket: z.record(z.array(z.string())).default({}),
    byProjectTheme: z.record(z.array(z.string())).default({}),
    bySystem: z.record(z.array(z.string())).default({}),
}).default({});

export const CategoryAnalysisSchema = z.object({
    label: z.string(),
    rankedIssues: z.array(RankedIssueItemSchema).default([]),
    themes: z.array(ThemeItemSchema).default([]),
    groups: GroupsSchema,
});

export const AnalysisSchema = z.object({
    summary: z.object({
        totalIssuesReviewed: z.number(),
        highPriorityCount: z.number(),
        duplicateGroupCount: z.number(),
        ideaCount: z.number().default(0),
        overallAssessment: z.string(),
        recommendedNextStep: z.string(),
    }),
    ideas: z.array(IdeaItemSchema).default([]),
    duplicateGroups: z.array(DuplicateGroupItemSchema).default([]),
    categories: z.object({
        josh: CategoryAnalysisSchema,
        old: CategoryAnalysisSchema,
        rest: CategoryAnalysisSchema,
    }),
});

export const ChunkAnalysisSchema = z.object({
    rankedIssues: z.array(RankedIssueItemSchema),
    duplicateGroups: z.array(DuplicateGroupItemSchema).default([]),
    themes: z.array(ThemeItemSchema).default([]),
    candidateIdeas: z.array(CandidateIdeaSchema).default([]),
});

export const DuplicateReviewSchema = z.object({
    duplicateGroups: z.array(DuplicateGroupItemSchema).default([]),
});

export const IdeaSynthesisSchema = z.object({
    ideas: z.array(IdeaItemSchema).default([]),
});
