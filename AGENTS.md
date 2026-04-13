# AGENTS.md

Guidance for coding agents working in this repository.

## Project at a glance

- **Name:** `superpowers`
- **Runtime:** Node.js (ES modules), `node >= 18`
- **Type:** MCP plugin(s) exposed over stdio
- **Primary files:**
  - `src/index.js` — main `superpowers` MCP server
  - `src/claude-md-management.js` — `claude-md-management` MCP server

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

Both MCP servers are **stdio-based** — they don't listen on network ports. To test them manually, pipe JSON-RPC messages via stdin:

```bash
printf '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0.0"}}}\n{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}\n' | timeout 5 node src/index.js
```

- The `src/__tests__/` directory may not contain test files yet; `npm test` exits cleanly with 0 tests in that case.
- No external services, databases, or Docker are required.
- There is no lint command configured — the project relies on `npm test` for validation.
