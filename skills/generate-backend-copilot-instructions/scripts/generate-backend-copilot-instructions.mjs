#!/usr/bin/env node

import {
    existsSync,
    mkdirSync,
    readdirSync,
    readFileSync,
    statSync,
    writeFileSync,
} from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const skillDir = resolve(__dirname, '..');
const agentTemplatesDir = join(skillDir, 'assets', 'agents');

const IGNORE_DIRS = new Set([
    '.git',
    '.github',
    '.idea',
    '.vscode',
    'coverage',
    'dist',
    'build',
    'node_modules',
    'tmp',
    'temp',
]);

const SOURCE_DIR_HINTS = ['src', 'app', 'lib', 'server', 'api'];

function usage() {
    console.log(`Backend AI instructions generator

Usage:
  create-backend-copilot-instructions [options]

Options:
  --target <path>  Project directory to inspect and write into (default: current directory)
  --requirement    User/project requirement to include in root instructions; can be repeated
  --dry-run        Show detected facts and files that would be created
  --force          Overwrite existing files
  --agents <list>  Create requested agents: comma-separated names or "all"
  --agent-direction <text>
                   Required when --agents is used; describes desired agent focus/content
  --help           Show this help
`);
}

function parseArgs(argv) {
    const options = {
        target: process.cwd(),
        requirements: [],
        dryRun: false,
        force: false,
        agents: [],
        agentDirection: '',
        help: false,
    };

    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        if (arg === '--target') {
            const value = argv[i + 1];
            if (!value || value.startsWith('--')) throw new Error('--target requires a path');
            options.target = value;
            i += 1;
        } else if (arg === '--requirement') {
            const value = argv[i + 1];
            if (!value || value.startsWith('--')) throw new Error('--requirement requires text');
            options.requirements.push(value);
            i += 1;
        } else if (arg === '--dry-run') {
            options.dryRun = true;
        } else if (arg === '--force') {
            options.force = true;
        } else if (arg === '--no-agents') {
            options.agents = [];
        } else if (arg === '--agents') {
            const value = argv[i + 1];
            if (!value || value.startsWith('--')) throw new Error('--agents requires a comma-separated list or "all"');
            options.agents = value
                .split(',')
                .map((name) => name.trim())
                .filter(Boolean);
            i += 1;
        } else if (arg === '--agent-direction') {
            const value = argv[i + 1];
            if (!value || value.startsWith('--')) throw new Error('--agent-direction requires text');
            options.agentDirection = value;
            i += 1;
        } else if (arg === '--help' || arg === '-h') {
            options.help = true;
        } else {
            throw new Error(`Unknown option: ${arg}`);
        }
    }

    return options;
}

function readJson(path) {
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, 'utf8'));
}

function listDir(path) {
    if (!existsSync(path)) return [];
    return readdirSync(path, { withFileTypes: true });
}

function isDirectory(path) {
    return existsSync(path) && statSync(path).isDirectory();
}

function walkFiles(root, maxDepth = 4, depth = 0) {
    if (depth > maxDepth || !isDirectory(root)) return [];

    const files = [];
    for (const entry of listDir(root)) {
        if (entry.isDirectory() && IGNORE_DIRS.has(entry.name)) continue;

        const fullPath = join(root, entry.name);
        if (entry.isDirectory()) {
            files.push(...walkFiles(fullPath, maxDepth, depth + 1));
        } else if (entry.isFile()) {
            files.push(fullPath);
        }
    }
    return files;
}

function hasAnyDependency(pkg, names) {
    const deps = {
        ...(pkg?.dependencies ?? {}),
        ...(pkg?.devDependencies ?? {}),
        ...(pkg?.peerDependencies ?? {}),
    };
    return names.some((name) => Boolean(deps[name]));
}

function detectProject(target) {
    const pkg = readJson(join(target, 'package.json'));
    const files = walkFiles(target);
    const relativeFiles = files.map((file) => relative(target, file));
    const sourceRoot = SOURCE_DIR_HINTS.find((dir) => isDirectory(join(target, dir))) ?? null;
    const sourceDirs = sourceRoot
        ? listDir(join(target, sourceRoot))
              .filter((entry) => entry.isDirectory() && !IGNORE_DIRS.has(entry.name))
              .map((entry) => entry.name)
              .sort()
        : [];

    const extensions = new Set(relativeFiles.map((file) => extname(file)).filter(Boolean));
    const scripts = pkg?.scripts ?? {};
    const frameworks = [];

    if (hasAnyDependency(pkg, ['@nestjs/core', '@nestjs/common']) || relativeFiles.some((file) => file.endsWith('.module.ts'))) {
        frameworks.push('NestJS');
    }
    if (hasAnyDependency(pkg, ['typeorm']) || relativeFiles.some((file) => file.includes('migrations/') || file.endsWith('.entity.ts'))) {
        frameworks.push('TypeORM');
    }
    if (hasAnyDependency(pkg, ['@prisma/client', 'prisma']) || relativeFiles.some((file) => file === 'prisma/schema.prisma')) {
        frameworks.push('Prisma');
    }
    if (hasAnyDependency(pkg, ['mongoose', '@nestjs/mongoose'])) {
        frameworks.push('Mongoose');
    }
    if (hasAnyDependency(pkg, ['kafkajs', '@nestjs/microservices']) || sourceDirs.includes('kafka')) {
        frameworks.push('Kafka');
    }
    if (hasAnyDependency(pkg, ['@nestjs/swagger', 'swagger-ui-express'])) {
        frameworks.push('OpenAPI/Swagger');
    }

    const modules = sourceRoot ? detectModules(join(target, sourceRoot), sourceRoot) : [];

    return {
        target,
        pkg,
        sourceRoot,
        sourceDirs,
        scripts,
        frameworks,
        modules,
        files: relativeFiles,
        extensions: [...extensions].sort(),
        hasTests: relativeFiles.some((file) => /\.(spec|test)\.[jt]sx?$/.test(file)),
        hasMigrations: relativeFiles.some((file) => file.includes('migrations/')),
    };
}

function detectModules(sourcePath, sourceRoot) {
    return listDir(sourcePath)
        .filter((entry) => entry.isDirectory() && !IGNORE_DIRS.has(entry.name))
        .map((entry) => {
            const dir = join(sourcePath, entry.name);
            const files = walkFiles(dir, 2).map((file) => relative(dir, file));
            return {
                name: entry.name,
                path: `${sourceRoot}/${entry.name}/`,
                hasModule: files.some((file) => file.endsWith('.module.ts')),
                hasController: files.some((file) => file.endsWith('.controller.ts')),
                hasService: files.some((file) => file.endsWith('.service.ts')),
                hasEntity: files.some((file) => file.includes('entities/') || file.endsWith('.entity.ts')),
                hasDto: files.some((file) => file.includes('dto/') || file.endsWith('.dto.ts')),
                hasTests: files.some((file) => /\.(spec|test)\.[jt]sx?$/.test(file)),
            };
        })
        .sort((a, b) => a.name.localeCompare(b.name));
}

function describeModule(module) {
    const parts = [];
    if (module.hasController) parts.push('controller');
    if (module.hasService) parts.push('service');
    if (module.hasEntity) parts.push('entities');
    if (module.hasDto) parts.push('DTOs');
    if (module.hasTests) parts.push('tests');
    return parts.length > 0 ? parts.join(', ') : 'source module';
}

function commandLineForScript(name) {
    return `npm run ${name}`;
}

function generateCopilot(project, requirements) {
    const buildCommands = ['build', 'test', 'test:cov', 'lint']
        .filter((name) => project.scripts[name])
        .map((name) => `- ${name === 'build' ? 'Build must pass' : name === 'lint' ? 'Lint must pass' : name === 'test:cov' ? 'Coverage report' : 'Tests must pass'}: \`${commandLineForScript(name)}\``);

    const structure = project.sourceDirs.length
        ? project.sourceDirs.map((dir) => `  ${dir}/`.padEnd(31, ' ') + `# ${inferDirectoryPurpose(dir)}`).join('\n')
        : '  # No standard source directories detected. Read the repository layout before editing.';

    const shared = sharedCodeRules(project);
    const frameworkSections = frameworkRules(project);
    const migrationRules = project.hasMigrations || project.frameworks.includes('TypeORM') ? typeormMigrationRules(project) : [];

    return `# General Code Review Standards

## Purpose

These instructions guide Copilot across all files in this repository.
Language-specific and framework-specific rules live in separate \`*.instructions.md\` files under \`.github/instructions/\`.

## Detected Project

- Target: \`${relative(process.cwd(), project.target) || '.'}\`
- Source root: ${project.sourceRoot ? `\`${project.sourceRoot}/\`` : 'not detected'}
- Frameworks: ${project.frameworks.length ? project.frameworks.join(', ') : 'none detected'}
- File types: ${project.extensions.length ? project.extensions.map((ext) => `\`${ext}\``).join(', ') : 'not detected'}

## Project Structure

\`\`\`
${project.sourceRoot ? `${project.sourceRoot}/\n${structure}` : structure}
\`\`\`

${project.modules.length ? moduleConventionSection(project) : ''}
${requirements.length ? `## User Requirements\n\n${requirements.map((requirement) => `- ${requirement}`).join('\n')}\n\n` : ''}## Shared Code — Use Before Creating New

${shared.length ? shared.join('\n') : '- Search existing modules, utilities, config, guards, filters, and constants before adding new shared code.'}

## Build & Quality Gates

${buildCommands.length ? buildCommands.join('\n') : '- Check \\`package.json\\` and project docs for build, test, coverage, and lint commands before handing work back.'}

## Code Quality Essentials

- Apply DRY and SOLID principles consistently across the codebase.
- Extract shared logic into reusable services, utilities, or modules; do not duplicate it.
- Keep functions and services focused and appropriately sized.
- Use clear, descriptive, intention-revealing names for variables, functions, classes, and modules.
- Remove dead code, unused imports, and commented-out blocks before committing.
- Prefer pure functions in utilities when practical.
- Enforce immutability for arguments and shared state unless mutation is an established local pattern.

## Comments & Documentation

- All comments must be written in English.
- Add comments only where the logic is non-obvious.
- Do not generate documentation files without explicit user request.
- Do not add JSDoc or docstrings to code that was not changed.

## Security Critical Issues

- Never hardcode credentials, API keys, tokens, or secrets; use environment variables and the project's config layer.
- Validate and sanitize all data received from external sources, including user input, API payloads, messages, and webhook bodies.
- Prevent SQL injection by using ORM query builders or repository methods; never concatenate untrusted input into raw SQL.
- Prevent SSRF by avoiding dynamic URLs built from untrusted user input.
- Review authentication and authorization on every endpoint; unauthenticated endpoints must be explicitly justified.
- Keep secrets out of code, logs, test snapshots, fixtures, and generated examples.

## Error Handling

- Handle errors at system boundaries: API calls, database operations, message consumers, jobs, and external services.
- Use framework-native exceptions and existing exception filters.
- Do not swallow errors silently; log with the existing logger or rethrow meaningful errors.
- Avoid defensive coding for impossible internal states unless the boundary is untrusted.

## Performance Red Flags

- Identify N+1 query patterns and suggest eager loading, joins, or batched queries.
- Avoid expensive operations inside request handlers; offload to background jobs or message consumers when appropriate.
- Use pagination for list endpoints; never return unbounded result sets.
- Prefer selective column loading over full entity fetches for large tables.
- Cache frequently accessed, rarely changed data where the project already supports caching.

${migrationRules.length ? `## Database & Migrations\n\n${migrationRules.join('\n')}\n\n` : ''}${frameworkSections.length ? `${frameworkSections.join('\n\n')}\n\n` : ''}## Testing Standards

- Write tests when they provide real value, especially for complex business logic, service methods, integrations, and critical utilities.
- Do not add tests for simple, self-evident code.
- Tests must cover edge cases and error conditions of the logic under test.
- Test names must clearly describe the scenario being tested.
- Mock external dependencies; prefer real behavior for internal modules unless isolation is required.

## Review Style

- Be specific and actionable; explain why a change is needed.
- Flag security vulnerabilities and breaking regressions as critical.
- Ask clarifying questions when the intent of the code is unclear.
`;
}

function inferDirectoryPurpose(dir) {
    const known = {
        auth: 'Authentication and authorization',
        config: 'Application configuration',
        constants: 'Application-wide constants',
        controllers: 'HTTP controllers',
        dto: 'Data transfer objects',
        entities: 'Persistence entities',
        filters: 'Exception filters',
        guards: 'Auth guards and permission decorators',
        jobs: 'Background jobs',
        kafka: 'Kafka transport and consumers',
        middleware: 'Request middleware',
        migrations: 'Database migrations',
        model: 'Shared models',
        models: 'Shared models',
        modules: 'Feature modules',
        services: 'Business services',
        test: 'Tests',
        tests: 'Tests',
        utils: 'Utility functions',
    };
    return known[dir] ?? humanize(dir);
}

function humanize(value) {
    return value.replace(/[-_]/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

function moduleConventionSection(project) {
    const nestModules = project.modules.filter((module) => module.hasModule || module.hasController || module.hasService);
    if (!nestModules.length) return '';

    const lines = nestModules.slice(0, 30).map((module) => `- \`${module.path}\` uses ${describeModule(module)}.`);
    const suffix = nestModules.length > 30 ? `\n- ${nestModules.length - 30} additional modules detected; inspect nearby files before editing.` : '';

    return `## Detected Module Structure

${lines.join('\n')}${suffix}

`;
}

function sharedCodeRules(project) {
    const dirs = new Set(project.sourceDirs);
    const rules = [];

    if (dirs.has('constants')) rules.push('- Always search the constants folder before defining new constants.');
    if (dirs.has('utils')) rules.push('- Always search the utilities folder before creating helper functions.');
    if (dirs.has('guards')) rules.push('- Always search guards and decorators before creating custom auth logic.');
    if (dirs.has('filters')) rules.push('- Always search exception filters before handling errors in a custom way.');
    if (dirs.has('config')) rules.push('- Always search config before adding new environment or infrastructure configuration.');
    if (dirs.has('audit-log')) rules.push('- Reuse the audit logging service for create/update tracking; do not build custom audit mechanisms.');
    if (project.files.some((file) => /logger/i.test(file))) rules.push('- Use the existing logger service; do not use `console.log()` directly.');

    return rules;
}

function frameworkRules(project) {
    const sections = [];

    if (project.frameworks.includes('NestJS')) {
        sections.push(`## NestJS Standards

- Keep controllers thin and put business behavior in services or domain classes.
- Use DTOs and validation decorators for request input.
- Keep modules cohesive; avoid importing unrelated modules for convenience.
- Prefer existing decorators, guards, interceptors, filters, repositories, and providers.
- Use NestJS testing utilities for unit tests when the surrounding tests do so.`);
    }

    if (project.frameworks.includes('Kafka')) {
        sections.push(`## Message Processing

- Treat message handlers as external boundaries.
- Validate payloads before use.
- Make retries idempotent where practical.
- Log enough context to debug failed messages without leaking secrets.`);
    }

    return sections;
}

function typeormMigrationRules() {
    return [
        '- Never use `synchronize: true` in production; use migrations.',
        '- Migrations must be reversible; implement both `up()` and `down()` methods.',
        '- Test migrations locally before committing when migration commands are available.',
        '- Use indexes intentionally for new query patterns.',
    ];
}

function generateNestInstructions() {
    return `---
applyTo: "**/*.{ts,tsx}"
---

# NestJS Backend Instructions

## Structure

- Keep controllers thin. Put business behavior in services or dedicated domain classes.
- Use DTOs and validation pipes for request input.
- Keep modules cohesive and avoid importing unrelated modules for convenience.
- Prefer existing decorators, guards, interceptors, filters, repositories, and providers.

## Safety

- Enforce authentication, authorization, tenancy, and ownership checks before accessing protected data.
- Keep transaction boundaries clear and as small as practical.
- Avoid leaking internal errors, stack traces, secrets, tokens, or raw database details.
- Validate external integration payloads before trusting them.

## Tests

- Add unit tests for service behavior and integration or e2e tests for API contract changes.
- Use existing test builders, fixtures, factories, and mocks.
- Cover validation failures, permission failures, and important edge cases.
`;
}

function generateTypeormInstructions() {
    return `---
applyTo: "**/*.{entity,migration}.ts"
---

# TypeORM Instructions

- Keep entities explicit and compatible with existing naming conventions.
- Do not enable schema synchronization for production paths.
- Write reversible migrations with \`up()\` and \`down()\`.
- Avoid raw SQL with untrusted input.
- Watch for N+1 queries and missing indexes when adding relationships or list endpoints.
`;
}

function generateTestingInstructions(project) {
    const applyTo = project.extensions.includes('.ts') ? '"**/*.{spec,test}.ts"' : '"**/*.{spec,test}.{js,ts}"';
    return `---
applyTo: ${applyTo}
---

# Backend Testing Instructions

- Follow the existing test framework and mocking style.
- Test behavior, edge cases, and error conditions.
- Mock external systems such as databases, queues, loggers, HTTP clients, and cloud services.
- Avoid brittle implementation-detail assertions unless the behavior requires them.
`;
}

function listAgentTemplates() {
    return walkFiles(agentTemplatesDir).map((template) => ({
        name: relative(agentTemplatesDir, template).replace(/\.agent\.md$/, ''),
        source: template,
    }));
}

function normalizeAgentSelection(requestedAgents) {
    if (!requestedAgents.length) return [];

    const templates = listAgentTemplates();
    const templateNames = new Set(templates.map((template) => template.name));
    const requested = requestedAgents.includes('all') ? [...templateNames] : requestedAgents;
    const unknown = requested.filter((name) => !templateNames.has(name));

    if (unknown.length) {
        throw new Error(`Unknown agent(s): ${unknown.join(', ')}. Available: ${[...templateNames].sort().join(', ')}`);
    }

    return templates.filter((template) => requested.includes(template.name));
}

function agentContent(source, direction) {
    const base = readFileSync(source, 'utf8').trimEnd();
    return `${base}

## User Direction

${direction}
`;
}

function plannedFiles(project, options) {
    const files = [
        {
            rel: '.github/copilot-instructions.md',
            content: generateCopilot(project, options.requirements),
        },
    ];

    if (project.frameworks.includes('NestJS')) {
        files.push({ rel: '.github/instructions/nestjs.instructions.md', content: generateNestInstructions() });
    }
    if (project.frameworks.includes('TypeORM')) {
        files.push({ rel: '.github/instructions/typeorm.instructions.md', content: generateTypeormInstructions() });
    }
    if (project.hasTests) {
        files.push({ rel: '.github/instructions/testing.instructions.md', content: generateTestingInstructions(project) });
    }

    if (options.agents.length) {
        if (!options.agentDirection.trim()) {
            throw new Error('--agent-direction is required when --agents is used');
        }

        for (const template of normalizeAgentSelection(options.agents)) {
            files.push({
                rel: join('.github', 'agents', relative(agentTemplatesDir, template.source)),
                content: agentContent(template.source, options.agentDirection),
            });
        }
    }

    return files;
}

function printSummary(project) {
    console.log('Detected project:');
    console.log(`- source root: ${project.sourceRoot ?? 'not detected'}`);
    console.log(`- frameworks: ${project.frameworks.length ? project.frameworks.join(', ') : 'none detected'}`);
    console.log(`- source directories: ${project.sourceDirs.length ? project.sourceDirs.join(', ') : 'none detected'}`);
    console.log(`- modules: ${project.modules.length}`);
    console.log(`- tests: ${project.hasTests ? 'yes' : 'no'}`);
    console.log(`- requested requirements: ${project.requirements?.length ?? 0}`);
    console.log('');
}

function writePlannedFiles(target, files, options) {
    let created = 0;
    let skipped = 0;
    let overwritten = 0;

    for (const file of files) {
        const dest = join(target, file.rel);
        const exists = existsSync(dest);
        const action = exists ? (options.force ? 'overwrite' : 'skip') : 'create';

        if (options.dryRun) {
            console.log(`[dry-run] ${action}: ${file.rel}`);
            continue;
        }

        if (exists && !options.force) {
            console.log(`[skip] ${file.rel}`);
            skipped += 1;
            continue;
        }

        mkdirSync(dirname(dest), { recursive: true });
        writeFileSync(dest, file.content);

        if (exists) {
            console.log(`[overwrite] ${file.rel}`);
            overwritten += 1;
        } else {
            console.log(`[create] ${file.rel}`);
            created += 1;
        }
    }

    console.log(`\nDone. Created: ${created}. Overwritten: ${overwritten}. Skipped: ${skipped}.`);
}

function main() {
    let options;
    try {
        options = parseArgs(process.argv.slice(2));
    } catch (err) {
        console.error(err.message);
        usage();
        process.exit(1);
    }

    if (options.help) {
        usage();
        return;
    }

    const target = resolve(options.target);
    if (!isDirectory(target)) {
        console.error(`Target directory does not exist: ${target}`);
        process.exit(1);
    }

    const project = detectProject(target);
    project.requirements = options.requirements;
    let files;

    try {
        files = plannedFiles(project, options);
    } catch (err) {
        console.error(err.message);
        process.exit(1);
    }

    printSummary(project);
    writePlannedFiles(target, files, options);
}

main();
