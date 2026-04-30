// skills-delivery — programmatic API placeholder
// Currently skills are used via CLI scripts in the skills/ directory.
// This module exports the list of available skills for tooling integration.

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const skills = ['generate-backend-copilot-instructions', 'browser-devtools', 'github-pr', 'jira'];

export function getSkillPath(name) {
    if (!skills.includes(name)) {
        throw new Error(`Unknown skill: "${name}". Available: ${skills.join(', ')}`);
    }
    return join(__dirname, 'skills', name);
}
