import { z } from 'zod';
import { ACTION_BUCKETS, PRODUCT_DOMAINS, TASK_KINDS, WORK_AREAS } from './taxonomy.ts';

export const WorkAreaSchema = z.enum(WORK_AREAS);
export const ProductDomainSchema = z.enum(PRODUCT_DOMAINS);
export const TaskKindSchema = z.enum(TASK_KINDS);
export const ActionBucketSchema = z.enum(ACTION_BUCKETS);

export const AnalysisSchema = z.object({
    summary: z.object({
        totalIssuesReviewed: z.number(),
        highPriorityCount: z.number(),
        duplicateGroupCount: z.number(),
        overallAssessment: z.string(),
        recommendedNextStep: z.string(),
    }),
    rankedIssues: z.array(z.object({
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
        systems: z.array(z.string()).describe('Concrete systems, integrations, applications, services, or partner names involved.').default([]),
        projectThemes: z.array(z.string()).describe('Short human-readable themes that group related work across issues.').default([]),
        actionBucket: ActionBucketSchema.describe('Practical queue for backlog cleanup and planning.').default('groom_first'),
    })),
    duplicateGroups: z.array(z.object({
        groupId: z.string(),
        issueKeys: z.array(z.string()),
        confidence: z.enum(['high', 'medium', 'low']),
        reason: z.string(),
        recommendedCanonicalKey: z.string(),
    })).default([]),
    themes: z.array(z.object({
        name: z.string(),
        issueKeys: z.array(z.string()).default([]),
        importance: z.enum(['critical', 'high', 'medium', 'low']).default('medium'),
        notes: z.string().default(''),
    })).default([]),
    groups: z.object({
        byWorkArea: z.record(z.array(z.string())).default({}),
        byProductDomain: z.record(z.array(z.string())).default({}),
        byTaskKind: z.record(z.array(z.string())).default({}),
        byActionBucket: z.record(z.array(z.string())).default({}),
        byProjectTheme: z.record(z.array(z.string())).default({}),
        bySystem: z.record(z.array(z.string())).default({}),
    }).default({}),
});

export const ChunkAnalysisSchema = z.object({
    rankedIssues: AnalysisSchema.shape.rankedIssues,
    duplicateGroups: AnalysisSchema.shape.duplicateGroups,
    themes: AnalysisSchema.shape.themes,
});

export const DuplicateReviewSchema = z.object({
    duplicateGroups: AnalysisSchema.shape.duplicateGroups,
});
