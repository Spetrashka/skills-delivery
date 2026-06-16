#!/usr/bin/env bun

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { config } from 'dotenv';
import { chatModel, DEFAULT_MODEL } from '../model.ts';
import { SKILL_DIR, DEFAULT_EXPORT_PATH, DEFAULT_ANALYSIS_PATH, DEFAULT_IDEAS_PATH } from './task-sorter/constants.ts';
import { parseArgs, booleanOption, printHelp } from './task-sorter/args.ts';
import { exportIssues } from './task-sorter/jira.ts';
import { toAnalysisInput, analyzeBacklog } from './task-sorter/backlog-analysis.ts';
import { writeJson, writeText } from './task-sorter/io.ts';
import { renderMarkdownReport, renderIdeasReport } from './task-sorter/render-md.ts';
import { renderHtmlReport, renderIdeasHtmlReport } from './task-sorter/render-html.ts';
import { synthesizeIdeas } from './task-sorter/idea-synthesis.ts';

config({ path: resolve(process.env.HOME, '.config/jira-mcp/.env') });
config({ path: resolve(SKILL_DIR, '.env'), override: true });

async function analyzeIssues(options) {
    const inputPath = resolve(options.input || DEFAULT_EXPORT_PATH);
    const outPath = resolve(options.out || DEFAULT_ANALYSIS_PATH);
    const reportPath = resolve(options.report || outPath.replace(/\.json$/i, '.md'));
    const htmlReportPath = resolve(options.html || options['html-report'] || reportPath.replace(/\.md$/i, '.html'));
    const exportPayload = JSON.parse(await readFile(inputPath, 'utf8'));
    const issues = toAnalysisInput(exportPayload, options);
    const modelName = options.model || DEFAULT_MODEL;
    console.log(`Using model: ${modelName}`);
    const model = await chatModel(modelName, {
        apiKey: options['api-key'],
        githubToken: options['github-token'],
        ollamaUrl: options['ollama-url'],
        think: booleanOption(options.think ?? process.env.OLLAMA_THINK, false),
    });
    const result = await analyzeBacklog(model, exportPayload, issues, options);
    const payload = {
        source: exportPayload.source,
        analyzedAt: new Date().toISOString(),
        model: modelName,
        reviewedIssueCount: issues.length,
        chunkSize: result.chunkSize,
        warnings: result.warnings,
        analysis: result.analysis,
    };
    await writeJson(outPath, payload);
    await writeText(reportPath, renderMarkdownReport(payload));
    await writeText(htmlReportPath, renderHtmlReport(payload));
    return { outPath, reportPath, htmlReportPath, count: issues.length };
}

async function synthesizeIdeasCommand(options) {
    const inputPath = resolve(options.input || DEFAULT_ANALYSIS_PATH);
    const outPath = resolve(options.out || DEFAULT_IDEAS_PATH);
    const reportPath = resolve(options.report || outPath.replace(/\.json$/i, '.md'));
    const htmlReportPath = resolve(options.html || options['html-report'] || reportPath.replace(/\.md$/i, '.html'));

    const analysisPayload = JSON.parse(await readFile(inputPath, 'utf8'));
    const { analysis, source } = analysisPayload;

    // Reconstruct all ranked issues across categories.
    const cats = analysis?.categories || {};
    const allRankedIssues = [
        ...(cats.josh?.rankedIssues || []),
        ...(cats.old?.rankedIssues || []),
        ...(cats.rest?.rankedIssues || []),
    ];

    // Optionally load source export for richer description context.
    let sourceIssues = [];
    if (options.export) {
        const exportPayload = JSON.parse(await readFile(resolve(options.export), 'utf8'));
        sourceIssues = exportPayload.issues || [];
    }

    const modelName = options.model || DEFAULT_MODEL;
    console.log(`Using model: ${modelName}`);
    const model = await chatModel(modelName, {
        apiKey: options['api-key'],
        githubToken: options['github-token'],
        ollamaUrl: options['ollama-url'],
        think: booleanOption(options.think ?? process.env.OLLAMA_THINK, false),
    });

    const warnings = [];
    console.error(`Synthesizing ideas for ${allRankedIssues.length} ranked issues...`);
    const ideas = await synthesizeIdeas(model, { source }, sourceIssues, allRankedIssues, [], warnings, options);

    const ideasPayload = {
        source,
        synthesizedAt: new Date().toISOString(),
        model: modelName,
        totalIssues: allRankedIssues.length,
        ideas,
        warnings,
    };

    await writeJson(outPath, ideasPayload);
    await writeText(reportPath, renderIdeasReport(ideasPayload));
    await writeText(htmlReportPath, renderIdeasHtmlReport(ideasPayload));
    if (warnings.length) for (const w of warnings) console.error(`Warning: ${w}`);
    return { outPath, reportPath, htmlReportPath, count: ideas.length };
}

async function renderReport(options) {
    const inputPath = resolve(options.input || DEFAULT_ANALYSIS_PATH);
    const reportPath = resolve(options.report || inputPath.replace(/\.json$/i, '.md'));
    const htmlReportPath = resolve(options.html || options['html-report'] || reportPath.replace(/\.md$/i, '.html'));
    const payload = JSON.parse(await readFile(inputPath, 'utf8'));
    await writeText(reportPath, renderMarkdownReport(payload));
    await writeText(htmlReportPath, renderHtmlReport(payload));
    return { reportPath, htmlReportPath, count: payload.reviewedIssueCount || payload.analysis?.summary?.totalIssuesReviewed || 0 };
}

const args = parseArgs(process.argv.slice(2));
const command = args._[0] || 'run';

try {
    if (args.help || args.h) {
        printHelp();
    } else if (command === 'export') {
        const result = await exportIssues(args);
        console.log(`Exported ${result.count} issues to ${result.outPath}`);
    } else if (command === 'analyze') {
        const result = await analyzeIssues(args);
        console.log(`Analyzed ${result.count} issues to ${result.outPath}`);
        console.log(`Report written to ${result.reportPath}`);
        console.log(`HTML report written to ${result.htmlReportPath}`);
    } else if (command === 'ideas') {
        const result = await synthesizeIdeasCommand(args);
        console.log(`Synthesized ${result.count} ideas to ${result.outPath}`);
        console.log(`Report written to ${result.reportPath}`);
        console.log(`HTML report written to ${result.htmlReportPath}`);
    } else if (command === 'render') {
        const result = await renderReport(args);
        console.log(`Rendered report for ${result.count} issues to ${result.reportPath}`);
        console.log(`Rendered HTML report to ${result.htmlReportPath}`);
    } else if (command === 'run') {
        const exportResult = await exportIssues({ ...args, out: args.exportOut || args.export || DEFAULT_EXPORT_PATH });
        const analyzeResult = await analyzeIssues({ ...args, input: exportResult.outPath, out: args.out || DEFAULT_ANALYSIS_PATH });
        console.log(`Exported ${exportResult.count} issues to ${exportResult.outPath}`);
        console.log(`Analyzed ${analyzeResult.count} issues to ${analyzeResult.outPath}`);
        console.log(`Report written to ${analyzeResult.reportPath}`);
        console.log(`HTML report written to ${analyzeResult.htmlReportPath}`);
    } else {
        printHelp();
        process.exitCode = 1;
    }
} catch (err) {
    console.error(`ERROR: ${err.message}`);
    process.exit(1);
}
