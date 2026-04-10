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

## Custom agent profiles

- `documentation-accuracy-reviewer`:
  - Definition file: `.claude/agents/documentation-accuracy-reviewer.md`
  - Purpose: verify docs stay accurate, complete, and in sync after API or feature changes.
