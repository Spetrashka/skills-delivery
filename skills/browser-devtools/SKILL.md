---
name: browser-devtools
description: "Connect to a running Firefox (or Chrome) browser via CDP Remote Debugging Protocol to extract CSS computed styles, console logs, JS errors, and evaluate expressions live on a development page. Use when asked to: inspect element styles, capture console output, get JS errors, evaluate expressions in the browser, debug CSS, check computed styles, read browser logs, get page styles. Triggers: 'browser styles', 'console logs', 'page errors', 'computed styles', 'inspect element', 'browser devtools', 'firefox logs', 'debug page', 'get styles from browser'."
argument-hint: 'styles <selector> | logs | errors | eval <expression> | list | screenshot'
---

# Browser DevTools Skill

## What This Does

Connects to Firefox (or any Chromium browser) via the Chrome DevTools Protocol (CDP) over a local WebSocket to:

-   List open browser tabs
-   Get computed CSS styles for any CSS selector
-   Capture console logs and JS errors
-   Evaluate arbitrary JavaScript expressions in the page context
-   Take screenshots (base64 PNG)

## Prerequisites

> **Firefox 129+ dropped CDP support.** Use Chrome or Chromium only.

1. **Start Chrome with remote debugging** (use a persistent debug profile to keep your session):

    ```bash
    google-chrome --remote-debugging-port=9222 --user-data-dir=$HOME/.chrome-debug-profile http://localhost:8080 &
    ```

    Log in once — the session is preserved in `~/.chrome-debug-profile` across reboots.

    > **Warning:** Do not use `/tmp/chrome-debug-profile` — `/tmp` is cleared on reboot and the session (cookies, login state) will be lost.

    **For Chromium:**

    ```bash
    chromium-browser --remote-debugging-port=9222 --user-data-dir=$HOME/.chrome-debug-profile http://localhost:8080 &
    ```

2. **Node.js 22+** is required for native WebSocket support (check: `node --version`).
    - If on Node 18–21, install `ws`: `npm install -g ws` then the script auto-detects it.

## CLI Location

All operations run through:

```
node ./scripts/browser-devtools.mjs <command> [args]
```

## Commands

| Command                            | Description                                  | Example                     |
| ---------------------------------- | -------------------------------------------- | --------------------------- |
| `list`                             | List all open tabs with their indexes        | `... list`                  |
| `styles <selector> [tabIndex]`     | Get computed CSS styles for a selector       | `... styles ".my-button" 0` |
| `styles-raw <selector> [tabIndex]` | Get only non-empty computed styles           | `... styles-raw "h1.title"` |
| `logs [tabIndex] [durationMs]`     | Capture console logs for N ms (default 5000) | `... logs 0 3000`           |
| `errors [tabIndex]`                | Get JS errors from the page                  | `... errors`                |
| `eval <expression> [tabIndex]`     | Evaluate JS in the page                      | `... eval "document.title"` |
| `screenshot [tabIndex]`            | Capture a screenshot (saves to /tmp)         | `... screenshot 0`          |

`tabIndex` defaults to `0` (the first/most-recently-active tab that is not the DevTools UI).

## Procedure

### 1. Verify browser is running with debugging enabled

```bash
curl -s http://localhost:9222/json/version | head -5
```

If this fails, start the browser using the command in Prerequisites above.

### 2. List open tabs to find the right one

```bash
node ./scripts/browser-devtools.mjs list
```

### 3. Run the desired command, specifying the tab index

```bash
# Get computed styles for a component selector
node ./scripts/browser-devtools.mjs styles-raw ".qxt-button--primary" 0

# Capture console output for 5 seconds
node ./scripts/browser-devtools.mjs logs 0 5000

# Evaluate an expression
node ./scripts/browser-devtools.mjs eval "window.__vuex__ ? 'vuex found' : 'no vuex'" 0
```

### 4. Parse and analyze the output

The script prints JSON to stdout. Analyze the returned styles/logs to identify the issue or answer the question.

## Troubleshooting

-   **`ECONNREFUSED 127.0.0.1:9222`**: Browser is not running with `--remote-debugging-port=9222`.
-   **Empty targets list**: Browser opened without the flag — restart with the flag.
-   **`WebSocket is not defined`**: Node.js < 22. Either upgrade or `npm install -g ws`.
-   **No matching elements** for selector: The page may not be loaded yet, or the selector is wrong — try `eval "document.querySelector('...')"` to verify.
-   **Firefox returns no tabs**: Firefox CDP support requires Firefox 86+. Try `--remote-debugging-port` (not `--start-debugger-server`).
