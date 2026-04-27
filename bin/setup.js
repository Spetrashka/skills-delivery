#!/usr/bin/env node
/**
 * skills-delivery setup — installs dependencies for skills that need them.
 *
 * Usage:
 *   node bin/setup.js            # install deps for all skills
 *   npx skills-delivery-setup    # same, when installed via npm
 */

import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const skillsDir = join(__dirname, '..', 'skills');

const skillNames = ['browser-devtools', 'github-pr', 'jira'];

for (const name of skillNames) {
    const skillPkgPath = join(skillsDir, name, 'package.json');
    if (!existsSync(skillPkgPath)) continue;

    const pkg = JSON.parse(readFileSync(skillPkgPath, 'utf8'));
    if (!pkg.dependencies || Object.keys(pkg.dependencies).length === 0) {
        console.log(`[${name}] no dependencies — skipping`);
        continue;
    }

    console.log(`[${name}] installing dependencies...`);
    try {
        execSync('npm install --omit=dev', {
            cwd: join(skillsDir, name),
            stdio: 'inherit',
        });
        console.log(`[${name}] done`);
    } catch (err) {
        console.error(`[${name}] npm install failed: ${err.message}`);
        process.exit(1);
    }
}

console.log('\nAll skill dependencies installed.');
