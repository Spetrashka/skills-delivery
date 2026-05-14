# Browser DevTools Skill

Connect to a running Chrome/Chromium browser via CDP (Chrome DevTools Protocol) to inspect styles, capture logs, get JS errors, and evaluate expressions live on a development page.

## Setup

No npm dependencies required — uses only Node.js built-ins.

**Requirements:**

- **Chrome or Chromium** — Firefox 129+ dropped CDP support
- **Node.js 22+** for native WebSocket support (on Node 18–21: `npm install -g ws`, auto-detected by the script)

### Launch browser with remote debugging

From this skill directory, use the bundled launcher:

```bash
node ./scripts/browser-devtools.mjs launch http://localhost:8080
```

It uses `$HOME/.chrome-debug-profile` by default so the debug browser keeps cookies and login state across reboots.

Manual commands:

```bash
# Chrome
google-chrome --remote-debugging-port=9222 --user-data-dir=$HOME/.chrome-debug-profile http://localhost:8080 &

# Chromium
chromium-browser --remote-debugging-port=9222 --user-data-dir=$HOME/.chrome-debug-profile http://localhost:8080 &
```

> **Important:** Use `$HOME/.chrome-debug-profile` (not `/tmp/...`).
> `/tmp` is cleared on reboot — your login session will be lost. `$HOME/.chrome-debug-profile` is persistent.

### Verify

```bash
curl -s http://localhost:9222/json/version | head -5
```

### Environment variables (optional)

| Variable   | Default     | Description               |
| ---------- | ----------- | ------------------------- |
| `CDP_HOST` | `localhost` | Browser host              |
| `CDP_PORT` | `9222`      | Browser remote debug port |
| `BROWSER` | auto-detect | Chrome/Chromium executable |
| `BROWSER_URL` | `http://localhost:8080` | Default URL for `launch` |
| `BROWSER_PROFILE_DIR` | `$HOME/.chrome-debug-profile` | Debug browser profile |

---

## Usage

From this skill directory:

```bash
node ./scripts/browser-devtools.mjs <command> [args]
```

| Command                            | Description                              |
| ---------------------------------- | ---------------------------------------- |
| `launch [url] [profileDir]`        | Start Chrome/Chromium with CDP enabled   |
| `list`                             | List all open tabs                       |
| `logs [tabIndex] [durationMs]`     | Capture console logs (default 5 seconds) |
| `errors [tabIndex]`                | Get JS errors from the page              |
| `styles <selector> [tabIndex]`     | Get computed CSS styles                  |
| `styles-raw <selector> [tabIndex]` | Get only non-empty computed styles       |
| `eval <expression> [tabIndex]`     | Evaluate JS in the page context          |
| `screenshot [tabIndex]`            | Take a screenshot (saved to /tmp)        |

### Examples

```bash
node ./scripts/browser-devtools.mjs launch http://localhost:8080
node ./scripts/browser-devtools.mjs list
node ./scripts/browser-devtools.mjs logs 0 5000
node ./scripts/browser-devtools.mjs errors 0
node ./scripts/browser-devtools.mjs styles-raw ".qxt-button--primary" 0
node ./scripts/browser-devtools.mjs eval "document.title" 0
```
