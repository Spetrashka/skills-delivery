import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export async function writeJson(filePath, payload) {
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

export async function writeText(filePath, text) {
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, text, 'utf8');
}
