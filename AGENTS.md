# AGENTS.md

Guidance for coding agents working in this repository.

## Project at a glance

- **Name:** `superpowers`
- **Runtime:** Node.js (ES modules), `node >= 18`
- **Type:** MCP plugin(s) exposed over stdio
- **Primary files:**
  - `src/index.js` — main `superpowers` MCP server
  - `src/claude-md-management.js` — `claude-md-management` MCP server
  - `src/gong.js` — Gong Engage contacts and flow assignment MCP server
  - `src/salesforce.js` — Salesforce Contact create and SOQL query MCP server

## Setup

```bash
npm install
```

## Common commands

```bash
npm test
npm start
```

- `npm test` runs Node's built-in test runner against `src/__tests__/*.test.js`.
- `npm start` launches `src/index.js`.

## Code style and implementation notes

- Use modern **ESM** imports/exports (`"type": "module"`).
- Keep tool definitions and handlers in sync:
  - If you add a tool in the `TOOLS` array, add a matching `switch` case in `CallToolRequestSchema`.
  - Keep `inputSchema.required` aligned with runtime validation.
- Prefer small, composable handler functions (same pattern as `handleRunShell`, `handleReadUrl`, etc.).
- Preserve current behavior unless explicitly asked to change it, especially:
  - timeouts for shell/network operations,
  - safe env var filtering,
  - output contract returned through `content: [{ type: "text", text: ... }]`.

## Validation checklist for changes

1. Run `npm test`.
2. If MCP tool behavior changed, manually verify:
   - `ListTools` still advertises expected tool names and schemas.
   - `CallTool` for updated tools returns JSON-serializable output.
3. Ensure no secrets are logged or returned unintentionally.

## Scope expectations for agents

- Make minimal, targeted changes.
- Do not introduce new dependencies unless required.
- If adding dependencies, use the package manager and latest stable versions.
- Update this file when workflow or conventions change.

## Cursor Cloud specific instructions

- **No external services required.** Both MCP servers (`src/index.js`, `src/claude-md-management.js`) are self-contained stdio processes — no databases, Docker, or network services to start.
- **Testing MCP servers interactively:** Because these are stdio-based MCP servers (not HTTP), you test them by piping JSON-RPC messages to stdin. The sequence is: send `initialize` → `notifications/initialized` → `tools/list` or `tools/call`. Example:
  ```bash
  printf '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0.0"}}}\n{"jsonrpc":"2.0","method":"notifications/initialized"}\n{"jsonrpc":"2.0","id":2,"method":"tools/list"}\n' | timeout 5 node src/index.js
  ```
- **No test files exist yet.** `npm test` runs successfully (0 tests, 0 failures) because the `src/__tests__/` directory has no `.test.js` files. The test runner harness works — just no tests to execute.
- **Lint:** No linter is configured in this project (no ESLint, Prettier, etc.). `npm test` is the primary verification command.
