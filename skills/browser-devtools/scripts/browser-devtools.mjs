#!/usr/bin/env node
/**
 * browser-devtools.mjs
 * Connects to a browser via Chrome DevTools Protocol (CDP).
 * Compatible with Firefox 86+ and Chrome/Chromium.
 *
 * Usage:
 *   node browser-devtools.mjs list
 *   node browser-devtools.mjs styles "<selector>" [tabIndex]
 *   node browser-devtools.mjs styles-raw "<selector>" [tabIndex]
 *   node browser-devtools.mjs logs [tabIndex] [durationMs]
 *   node browser-devtools.mjs errors [tabIndex]
 *   node browser-devtools.mjs eval "<expression>" [tabIndex]
 *   node browser-devtools.mjs screenshot [tabIndex]
 *   node browser-devtools.mjs launch [url]
 */

import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

const CDP_HOST = process.env.CDP_HOST ?? 'localhost';
const CDP_PORT = parseInt(process.env.CDP_PORT ?? '9222', 10);
const BASE_URL = `http://${CDP_HOST}:${CDP_PORT}`;
const DEFAULT_BROWSER_URL = process.env.BROWSER_URL ?? 'http://localhost:8080';
const DEFAULT_PROFILE_DIR = process.env.BROWSER_PROFILE_DIR ?? join(homedir(), '.chrome-debug-profile');

// ─── WebSocket resolution ─────────────────────────────────────────────────────

async function resolveWebSocket() {
    // Node 22+ ships native WebSocket
    if (typeof globalThis.WebSocket !== 'undefined') {
        return globalThis.WebSocket;
    }
    // Try 'ws' package as fallback
    try {
        const require = createRequire(import.meta.url);
        const { default: WS } = await import('ws').catch(() => ({ default: require('ws') }));
        return WS;
    } catch {
        throw new Error('WebSocket not available.\n' + '  - Upgrade to Node.js 22+, OR\n' + '  - Run: npm install -g ws');
    }
}

// ─── CDP HTTP helpers ─────────────────────────────────────────────────────────

async function fetchJson(path) {
    const res = await fetch(`${BASE_URL}${path}`);
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${BASE_URL}${path}`);
    return res.json();
}

/** List targets — Chrome uses /json/list, Firefox exposes targets via WebSocket Target domain. */
async function listTargets() {
    // Try Chrome-style HTTP endpoint first
    try {
        return await fetchJson('/json/list');
    } catch {
        // Firefox: no HTTP targets list — get them via the browser WebSocket
        return await listTargetsViaWebSocket();
    }
}

async function listTargetsViaWebSocket() {
    // Firefox exposes a browser-level WebSocket at the root path
    const versionRes = await fetch(`${BASE_URL}/json/version`).catch(() => null);
    let browserWsUrl;

    if (versionRes?.ok) {
        const data = await versionRes.json();
        browserWsUrl = data.webSocketDebuggerUrl;
    }

    if (!browserWsUrl) {
        // Firefox fallback: connect directly to ws://host:port
        browserWsUrl = `ws://${CDP_HOST}:${CDP_PORT}`;
    }

    const session = await CDPSession.connect(browserWsUrl);
    try {
        const { targetInfos } = await session.send('Target.getTargets');
        return targetInfos.map(t => ({
            id: t.targetId,
            type: t.type,
            title: t.title,
            url: t.url,
            webSocketDebuggerUrl: `ws://${CDP_HOST}:${CDP_PORT}/devtools/page/${t.targetId}`,
        }));
    } finally {
        session.close();
    }
}

/** Filter out DevTools UI tabs and pick the tab at tabIndex (0-based). */
function pickTarget(targets, tabIndex = 0) {
    const pages = targets.filter(t => t.type === 'page' && !t.url.startsWith('devtools://'));
    if (pages.length === 0) throw new Error('No page targets found. Is the browser open to a page?');
    if (tabIndex >= pages.length) {
        throw new Error(`tabIndex ${tabIndex} out of range (${pages.length} page(s) available).`);
    }
    return pages[tabIndex];
}

// ─── CDP Session ─────────────────────────────────────────────────────────────

class CDPSession {
    #ws;
    #nextId = 1;
    #pending = new Map();
    #handlers = new Map();

    static async connect(wsUrl) {
        const WS = await resolveWebSocket();
        return new Promise((resolve, reject) => {
            const ws = new WS(wsUrl);
            const session = new CDPSession(ws);
            ws.addEventListener('open', () => resolve(session));
            ws.addEventListener('error', err => reject(err.message ?? err));
        });
    }

    constructor(ws) {
        this.#ws = ws;
        ws.addEventListener('message', event => {
            const msg = JSON.parse(event.data);
            if (msg.id !== undefined) {
                const { resolve, reject } = this.#pending.get(msg.id) ?? {};
                this.#pending.delete(msg.id);
                if (msg.error) reject?.(new Error(msg.error.message));
                else resolve?.(msg.result);
            } else if (msg.method) {
                this.#handlers.get(msg.method)?.(msg.params);
            }
        });
    }

    send(method, params = {}) {
        return new Promise((resolve, reject) => {
            const id = this.#nextId++;
            this.#pending.set(id, { resolve, reject });
            this.#ws.send(JSON.stringify({ id, method, params }));
        });
    }

    on(event, handler) {
        this.#handlers.set(event, handler);
    }

    close() {
        this.#ws.close();
    }
}

// ─── Commands ────────────────────────────────────────────────────────────────

async function cmdList() {
    const targets = await listTargets();
    const pages = targets
        .filter(t => t.type === 'page' && !t.url.startsWith('devtools://'))
        .map((t, i) => ({ index: i, title: t.title, url: t.url, id: t.id }));
    console.log(JSON.stringify(pages, null, 2));
}

async function cmdStyles(selector, tabIndex, rawOnly) {
    const targets = await listTargets();
    const target = pickTarget(targets, tabIndex);
    const session = await CDPSession.connect(target.webSocketDebuggerUrl);

    try {
        await session.send('DOM.enable');
        await session.send('CSS.enable');

        // Find the node
        const { root } = await session.send('DOM.getDocument', { depth: 0 });
        const { nodeId } = await session.send('DOM.querySelector', {
            nodeId: root.nodeId,
            selector,
        });

        if (!nodeId) {
            console.log(JSON.stringify({ error: `No element found for selector: "${selector}"` }));
            return;
        }

        // Get computed styles via Runtime.evaluate — more reliable cross-browser
        const expression = `
      (function() {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return null;
        const cs = window.getComputedStyle(el);
        const result = {};
        for (let i = 0; i < cs.length; i++) {
          const prop = cs[i];
          result[prop] = cs.getPropertyValue(prop).trim();
        }
        return result;
      })()
    `;

        const { result } = await session.send('Runtime.evaluate', {
            expression,
            returnByValue: true,
        });

        if (result.value === null) {
            console.log(JSON.stringify({ error: `No element found for selector: "${selector}"` }));
            return;
        }

        const styles = result.value;
        const output = rawOnly
            ? Object.fromEntries(Object.entries(styles).filter(([, v]) => v !== '' && v !== 'normal' && v !== 'none' && v !== 'auto'))
            : styles;

        console.log(JSON.stringify({ selector, tabUrl: target.url, styles: output }, null, 2));
    } finally {
        session.close();
    }
}

async function cmdLogs(tabIndex, durationMs) {
    const targets = await listTargets();
    const target = pickTarget(targets, tabIndex);
    const session = await CDPSession.connect(target.webSocketDebuggerUrl);

    const logs = [];

    try {
        await session.send('Runtime.enable');
        await session.send('Log.enable');

        session.on('Runtime.consoleAPICalled', params => {
            logs.push({
                type: params.type,
                args: params.args.map(a => a.value ?? a.description ?? a.type),
                timestamp: params.timestamp,
            });
        });

        session.on('Log.entryAdded', params => {
            logs.push({
                type: params.entry.level,
                source: params.entry.source,
                text: params.entry.text,
                timestamp: params.entry.timestamp,
            });
        });

        await new Promise(resolve => setTimeout(resolve, durationMs));

        console.log(JSON.stringify({ tabUrl: target.url, durationMs, logs }, null, 2));
    } finally {
        session.close();
    }
}

async function cmdErrors(tabIndex) {
    const targets = await listTargets();
    const target = pickTarget(targets, tabIndex);
    const session = await CDPSession.connect(target.webSocketDebuggerUrl);

    const errors = [];

    try {
        await session.send('Runtime.enable');

        session.on('Runtime.exceptionThrown', params => {
            const ex = params.exceptionDetails;
            errors.push({
                text: ex.text,
                exception: ex.exception?.description ?? ex.exception?.value,
                url: ex.url,
                lineNumber: ex.lineNumber,
                columnNumber: ex.columnNumber,
                timestamp: params.timestamp,
            });
        });

        // Wait 3 seconds to catch errors triggered on the current page
        await new Promise(resolve => setTimeout(resolve, 3000));

        console.log(JSON.stringify({ tabUrl: target.url, errors }, null, 2));
    } finally {
        session.close();
    }
}

async function cmdEval(expression, tabIndex) {
    const targets = await listTargets();
    const target = pickTarget(targets, tabIndex);
    const session = await CDPSession.connect(target.webSocketDebuggerUrl);

    try {
        await session.send('Runtime.enable');
        const { result, exceptionDetails } = await session.send('Runtime.evaluate', {
            expression,
            returnByValue: true,
            awaitPromise: true,
        });

        if (exceptionDetails) {
            console.log(
                JSON.stringify(
                    {
                        error: exceptionDetails.text,
                        exception: exceptionDetails.exception?.description,
                    },
                    null,
                    2
                )
            );
        } else {
            console.log(JSON.stringify({ tabUrl: target.url, expression, result: result.value }, null, 2));
        }
    } finally {
        session.close();
    }
}

async function cmdDiagnose(tabIndex, durationMs) {
    const targets = await listTargets();
    const target = pickTarget(targets, tabIndex);
    const session = await CDPSession.connect(target.webSocketDebuggerUrl);

    const warnings = [];
    const errors = [];
    const exceptions = [];

    try {
        await session.send('Runtime.enable');
        await session.send('Log.enable');
        await session.send('Page.enable');

        session.on('Runtime.consoleAPICalled', params => {
            const args = params.args.map(a => a.value ?? a.description ?? a.type);
            if (params.type === 'warning') {
                warnings.push({ args, timestamp: params.timestamp });
            } else if (params.type === 'error') {
                errors.push({ args, timestamp: params.timestamp });
            }
        });

        session.on('Log.entryAdded', params => {
            const entry = {
                source: params.entry.source,
                text: params.entry.text,
                url: params.entry.url,
                timestamp: params.entry.timestamp,
            };
            if (params.entry.level === 'warning') warnings.push(entry);
            else if (params.entry.level === 'error') errors.push(entry);
        });

        session.on('Runtime.exceptionThrown', params => {
            const ex = params.exceptionDetails;
            exceptions.push({
                text: ex.text,
                exception: ex.exception?.description ?? ex.exception?.value,
                url: ex.url,
                line: ex.lineNumber,
                col: ex.columnNumber,
                timestamp: params.timestamp,
            });
        });

        // Reload so all startup warnings/errors fire fresh
        await session.send('Page.reload');

        await new Promise(resolve => setTimeout(resolve, durationMs));

        const total = warnings.length + errors.length + exceptions.length;
        console.log(
            JSON.stringify(
                {
                    tabUrl: target.url,
                    durationMs,
                    summary: { warnings: warnings.length, errors: errors.length, exceptions: exceptions.length, total },
                    warnings,
                    errors,
                    exceptions,
                },
                null,
                2
            )
        );
    } finally {
        session.close();
    }
}

async function cmdNetworkErrors(tabIndex, durationMs) {
    const targets = await listTargets();
    const target = pickTarget(targets, tabIndex);
    const session = await CDPSession.connect(target.webSocketDebuggerUrl);

    const requests = new Map();
    const failed = [];

    try {
        await session.send('Network.enable');

        session.on('Network.requestWillBeSent', params => {
            requests.set(params.requestId, {
                url: params.request.url,
                method: params.request.method,
                initiator: params.initiator?.type,
            });
        });

        session.on('Network.responseReceived', params => {
            const req = requests.get(params.requestId);
            if (req && params.response.status >= 400) {
                failed.push({
                    type: 'http-error',
                    status: params.response.status,
                    statusText: params.response.statusText,
                    url: params.response.url,
                    method: req.method,
                    initiator: req.initiator,
                    mimeType: params.response.mimeType,
                });
            }
            requests.delete(params.requestId);
        });

        session.on('Network.loadingFailed', params => {
            const req = requests.get(params.requestId);
            if (req && !params.canceled) {
                failed.push({
                    type: 'load-failed',
                    url: req.url,
                    method: req.method,
                    initiator: req.initiator,
                    errorText: params.errorText,
                    blocked: params.blockedReason ?? null,
                });
            }
            requests.delete(params.requestId);
        });

        await new Promise(resolve => setTimeout(resolve, durationMs));

        console.log(JSON.stringify({ tabUrl: target.url, durationMs, failed }, null, 2));
    } finally {
        session.close();
    }
}

async function cmdNetworkSnapshot(tabIndex) {
    const targets = await listTargets();
    const target = pickTarget(targets, tabIndex);
    const session = await CDPSession.connect(target.webSocketDebuggerUrl);

    try {
        await session.send('Runtime.enable');
        const expression = `
            (function() {
                return performance.getEntriesByType('resource')
                    .filter(r =>
                        r.responseStatus >= 400 ||
                        (r.responseStatus === 0 && r.transferSize === 0 && r.decodedBodySize === 0 && r.duration > 0)
                    )
                    .map(r => ({
                        name: r.name,
                        status: r.responseStatus,
                        duration: Math.round(r.duration),
                        initiatorType: r.initiatorType,
                    }));
            })()
        `;
        const { result, exceptionDetails } = await session.send('Runtime.evaluate', {
            expression,
            returnByValue: true,
        });

        if (exceptionDetails) {
            console.log(JSON.stringify({ error: exceptionDetails.text }, null, 2));
        } else {
            console.log(JSON.stringify({ tabUrl: target.url, failed: result.value }, null, 2));
        }
    } finally {
        session.close();
    }
}

async function cmdScreenshot(tabIndex) {
    const targets = await listTargets();
    const target = pickTarget(targets, tabIndex);
    const session = await CDPSession.connect(target.webSocketDebuggerUrl);

    try {
        const { data } = await session.send('Page.captureScreenshot', { format: 'png' });
        const outPath = join(tmpdir(), `screenshot-${Date.now()}.png`);
        writeFileSync(outPath, Buffer.from(data, 'base64'));
        console.log(JSON.stringify({ tabUrl: target.url, savedTo: outPath }));
    } finally {
        session.close();
    }
}

function commandExists(command) {
    const result = spawnSync(command, ['--version'], {
        stdio: 'ignore',
    });
    return result.status === 0 || result.signal === 'SIGTERM';
}

function resolveBrowserCommand() {
    if (process.env.BROWSER) return process.env.BROWSER;

    const candidates = ['google-chrome', 'google-chrome-stable', 'chromium-browser', 'chromium', 'chrome'];
    return candidates.find(commandExists);
}

function cmdLaunch(url = DEFAULT_BROWSER_URL, profileDir = DEFAULT_PROFILE_DIR) {
    const browser = resolveBrowserCommand();
    if (!browser) {
        throw new Error('No Chrome/Chromium executable found. Set BROWSER=/path/to/chrome and try again.');
    }

    const args = [
        `--remote-debugging-port=${CDP_PORT}`,
        `--user-data-dir=${profileDir}`,
        '--no-first-run',
        '--no-default-browser-check',
        url,
    ];

    const child = spawn(browser, args, {
        detached: true,
        stdio: 'ignore',
    });
    child.unref();

    console.log(
        JSON.stringify(
            {
                browser,
                pid: child.pid,
                url,
                debugUrl: BASE_URL,
                profileDir,
            },
            null,
            2
        )
    );
}

// ─── CLI entrypoint ───────────────────────────────────────────────────────────

const [, , command, arg1, arg2] = process.argv;

async function main() {
    switch (command) {
        case 'launch':
            cmdLaunch(arg1, arg2);
            break;

        case 'list':
            await cmdList();
            break;

        case 'styles':
            if (!arg1) throw new Error('Usage: styles "<selector>" [tabIndex]');
            await cmdStyles(arg1, parseInt(arg2 ?? '0', 10), false);
            break;

        case 'styles-raw':
            if (!arg1) throw new Error('Usage: styles-raw "<selector>" [tabIndex]');
            await cmdStyles(arg1, parseInt(arg2 ?? '0', 10), true);
            break;

        case 'logs':
            await cmdLogs(parseInt(arg1 ?? '0', 10), parseInt(arg2 ?? '5000', 10));
            break;

        case 'errors':
            await cmdErrors(parseInt(arg1 ?? '0', 10));
            break;

        case 'eval':
            if (!arg1) throw new Error('Usage: eval "<js expression>" [tabIndex]');
            await cmdEval(arg1, parseInt(arg2 ?? '0', 10));
            break;

        case 'screenshot':
            await cmdScreenshot(parseInt(arg1 ?? '0', 10));
            break;

        case 'network-errors':
            await cmdNetworkErrors(parseInt(arg1 ?? '0', 10), parseInt(arg2 ?? '8000', 10));
            break;

        case 'network-snapshot':
            await cmdNetworkSnapshot(parseInt(arg1 ?? '0', 10));
            break;

        case 'diagnose':
            await cmdDiagnose(parseInt(arg1 ?? '0', 10), parseInt(arg2 ?? '10000', 10));
            break;

        default:
            console.error(
                [
                    'Usage: node browser-devtools.mjs <command> [args]',
                    '',
                    'Commands:',
                    '  launch [url] [profileDir]          Start Chrome/Chromium with remote debugging',
                    '  list                              List open browser tabs',
                    '  styles "<selector>" [tabIndex]    Get all computed CSS styles',
                    '  styles-raw "<selector>" [idx]     Get non-default computed styles only',
                    '  logs [tabIndex] [durationMs]      Capture console output (default 5000ms)',
                    '  errors [tabIndex]                 Capture JS errors (waits 3s)',
                    '  eval "<expression>" [tabIndex]    Evaluate JS in the page',
                    '  screenshot [tabIndex]             Save screenshot to /tmp',
                    '  network-errors [tabIndex] [ms]    Capture failed/errored network requests (live, CDP)',
                    '  network-snapshot [tabIndex]        Snapshot already-loaded failed requests (performance API)',
                    '  diagnose [tabIndex] [ms]            Reload page and capture all warnings+errors+exceptions (default 10000ms)',
                    '',
                    'Environment:',
                    '  CDP_HOST  Browser host (default: localhost)',
                    '  CDP_PORT  Browser debug port (default: 9222)',
                    '',
                    'Start Chrome (keeps session with --user-data-dir):',
                    '  node browser-devtools.mjs launch http://localhost:8080',
                    '',
                    'Note: Firefox 129+ dropped CDP support — Chrome/Chromium only.',
                ].join('\n')
            );
            process.exit(1);
    }
}

main().catch(err => {
    console.error(JSON.stringify({ error: err.message }));
    process.exit(1);
});
