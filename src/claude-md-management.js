#!/usr/bin/env node
/**
 * claude-md-management — Claude Code MCP plugin
 *
 * Provides tools for managing CLAUDE.md files:
 *   - read_claude_md     : read the contents of a CLAUDE.md file
 *   - write_claude_md    : write or overwrite a CLAUDE.md file
 *   - append_to_claude_md: append content to an existing CLAUDE.md file
 *   - list_claude_md     : find all CLAUDE.md files under a directory
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import {
  readFileSync,
  writeFileSync,
  appendFileSync,
  existsSync,
  mkdirSync,
} from "fs";
import { resolve, dirname } from "path";
import { execSync } from "child_process";

const TOOLS = [
  {
    name: "read_claude_md",
    description:
      "Read the contents of a CLAUDE.md file at the given path. Returns the file content as a string.",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description:
            "Absolute or relative path to the CLAUDE.md file (or its parent directory).",
        },
      },
      required: ["path"],
    },
  },
  {
    name: "write_claude_md",
    description:
      "Create or overwrite a CLAUDE.md file at the given path with the provided content.",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description:
            "Absolute or relative path to the CLAUDE.md file (or its parent directory).",
        },
        content: {
          type: "string",
          description: "Markdown content to write to the file.",
        },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "append_to_claude_md",
    description:
      "Append content to an existing CLAUDE.md file. Creates the file if it does not exist.",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description:
            "Absolute or relative path to the CLAUDE.md file (or its parent directory).",
        },
        content: {
          type: "string",
          description: "Markdown content to append.",
        },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "list_claude_md",
    description:
      "Recursively find all CLAUDE.md files under a given directory.",
    inputSchema: {
      type: "object",
      properties: {
        directory: {
          type: "string",
          description: "Root directory to search. Defaults to current working directory.",
        },
      },
      required: [],
    },
  },
];

// ── helpers ────────────────────────────────────────────────────────────────────

/**
 * Resolve a user-supplied path to an absolute CLAUDE.md file path.
 * If `p` points to a directory, appends "CLAUDE.md". If it ends with
 * "CLAUDE.md" already, uses it as-is.
 */
function resolveMdPath(p) {
  const abs = resolve(p);
  if (abs.endsWith("CLAUDE.md")) return abs;
  return resolve(abs, "CLAUDE.md");
}

// ── tool handlers ──────────────────────────────────────────────────────────────

function handleReadClaudeMd({ path: p }) {
  if (!p || typeof p !== "string") throw new Error("'path' is required.");
  const filePath = resolveMdPath(p);
  if (!existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }
  const content = readFileSync(filePath, "utf8");
  return { path: filePath, content };
}

function handleWriteClaudeMd({ path: p, content }) {
  if (!p || typeof p !== "string") throw new Error("'path' is required.");
  if (content === undefined || content === null)
    throw new Error("'content' is required.");
  const filePath = resolveMdPath(p);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, content, "utf8");
  return { path: filePath, bytesWritten: Buffer.byteLength(content, "utf8") };
}

function handleAppendToClaudeMd({ path: p, content }) {
  if (!p || typeof p !== "string") throw new Error("'path' is required.");
  if (!content || typeof content !== "string")
    throw new Error("'content' is required.");
  const filePath = resolveMdPath(p);
  mkdirSync(dirname(filePath), { recursive: true });
  const separator = existsSync(filePath) ? "\n" : "";
  appendFileSync(filePath, separator + content, "utf8");
  return { path: filePath, bytesAppended: Buffer.byteLength(content, "utf8") };
}

function handleListClaudeMd({ directory = "." }) {
  const root = resolve(directory);
  let raw;
  try {
    raw = execSync(`find "${root}" -name "CLAUDE.md" -not -path "*/.git/*"`, {
      encoding: "utf8",
      timeout: 10_000,
    });
  } catch (err) {
    raw = (err.stdout ?? "").trimEnd();
  }
  const files = raw
    .trim()
    .split("\n")
    .filter(Boolean)
    .sort();
  return { root, count: files.length, files };
}

// ── server setup ───────────────────────────────────────────────────────────────

const server = new Server(
  { name: "claude-md-management", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  let result;
  switch (name) {
    case "read_claude_md":
      result = handleReadClaudeMd(args ?? {});
      break;
    case "write_claude_md":
      result = handleWriteClaudeMd(args ?? {});
      break;
    case "append_to_claude_md":
      result = handleAppendToClaudeMd(args ?? {});
      break;
    case "list_claude_md":
      result = handleListClaudeMd(args ?? {});
      break;
    default:
      throw new Error(`Unknown tool: ${name}`);
  }

  return {
    content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
  };
});

const transport = new StdioServerTransport();
await server.connect(transport);
