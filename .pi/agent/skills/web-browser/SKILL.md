---
name: web-browser
description: "Browser automation using the agent-browser CLI (Chromium via Playwright). Use it to navigate pages, capture snapshots, and interact with elements."
license: Apache-2.0
---

# Web Browser Skill (agent-browser)

Use **agent-browser** for web automation. It runs a headless Chromium instance by default and exposes a CLI optimized for AI agents.

> Full command reference: `agent-browser --help`

## Installation

```bash
npm install -g agent-browser
agent-browser install              # Download Chromium
# Linux only:
agent-browser install --with-deps  # Install system deps
```

## Core Workflow (recommended)

1. **Open a page**
   ```bash
   agent-browser open https://example.com
   ```
2. **Get a snapshot (refs)**
   ```bash
   agent-browser snapshot -i        # Interactive elements only
   # or JSON for machine parsing
   agent-browser snapshot -i --json
   ```
3. **Interact using refs**
   ```bash
   agent-browser click @e2
   agent-browser fill @e3 "test@example.com"
   agent-browser get text @e1
   ```
4. **Re-snapshot after changes**
   ```bash
   agent-browser snapshot -i --json
   ```

Refs (`@e1`, `@e2`, …) are deterministic and ideal for AI workflows.

## Common Commands

```bash
agent-browser open <url>            # Navigate (alias: goto)
agent-browser snapshot              # Accessibility tree with refs
agent-browser click <sel|@ref>
agent-browser fill <sel|@ref> <text>
agent-browser type <sel|@ref> <text>
agent-browser press <key>           # e.g. Enter, Tab, Control+a
agent-browser get text <sel|@ref>
agent-browser screenshot [path]     # Use --full for full page
agent-browser close                 # Close browser
```

### Semantic Finders (optional)

```bash
agent-browser find role button click --name "Submit"
agent-browser find label "Email" fill "test@test.com"
```

## Helpful Options

- **Headed mode (visible browser):**
  ```bash
  agent-browser open https://example.com --headed
  ```
- **Persistent profile (cookies/logins):**
  ```bash
  agent-browser --profile ~/.myapp-profile open https://example.com
  ```
- **Isolated sessions:**
  ```bash
  agent-browser --session agent1 open https://example.com
  ```
- **Agent-friendly JSON output:**
  ```bash
  agent-browser snapshot -i --json
  agent-browser get text @e1 --json
  ```
- **Local files (file://):**
  ```bash
  agent-browser --allow-file-access open file:///path/to/page.html
  ```

## When to Use

Use this skill whenever the agent needs to browse the web, inspect pages, click buttons, fill forms, or capture screenshots.
