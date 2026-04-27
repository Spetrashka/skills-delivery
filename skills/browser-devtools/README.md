# Browser DevTools Skill

Connect to a running Chrome/Chromium browser via CDP (Chrome DevTools Protocol) to inspect styles, capture logs, get JS errors, and evaluate expressions live on a development page.

## Launching the Browser

### Chrome

```bash
google-chrome --remote-debugging-port=9222 --user-data-dir=$HOME/.chrome-debug-profile http://localhost:8080 &
```

### Chromium

```bash
chromium-browser --remote-debugging-port=9222 --user-data-dir=$HOME/.chrome-debug-profile http://localhost:8080 &
```

> **Important:** Use `$HOME/.chrome-debug-profile` (not `/tmp/...`).
> `/tmp` is cleared on reboot — using it means your login session (cookies, auth tokens) will be lost after every restart.
> `$HOME/.chrome-debug-profile` is persistent: log in once and the session survives reboots.

### Verify the browser is running

```bash
curl -s http://localhost:9222/json/version | head -5
```

If this returns nothing, the browser is not running with remote debugging enabled — restart it using the command above.

---

## Usage

All commands run through `browser-devtools.mjs`:

```bash
node ./scripts/browser-devtools.mjs <command> [args]
```

| Command                            | Description                              |
| ---------------------------------- | ---------------------------------------- |
| `list`                             | List all open tabs                       |
| `logs [tabIndex] [durationMs]`     | Capture console logs (default 5 seconds) |
| `errors [tabIndex]`                | Get JS errors from the page              |
| `styles <selector> [tabIndex]`     | Get computed CSS styles                  |
| `styles-raw <selector> [tabIndex]` | Get only non-empty computed styles       |
| `eval <expression> [tabIndex]`     | Evaluate JS in the page context          |
| `screenshot [tabIndex]`            | Take a screenshot (saved to /tmp)        |

### Examples

```bash
# List open tabs
node ./scripts/browser-devtools.mjs list

# Capture console logs for 5 seconds
node ./scripts/browser-devtools.mjs logs 0 5000

# Get JS errors
node ./scripts/browser-devtools.mjs errors 0

# Inspect computed styles of a button
node ./scripts/browser-devtools.mjs styles-raw ".qxt-button--primary" 0

# Evaluate an expression
node ./scripts/browser-devtools.mjs eval "document.title" 0
```

---

## Requirements

-   **Chrome or Chromium** — Firefox 129+ dropped CDP support
-   **Node.js 22+** for native WebSocket support
    On Node 18–21: `npm install -g ws` (auto-detected by the script)
