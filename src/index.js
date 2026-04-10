#!/usr/bin/env node
/**
 * superpowers — Claude Code MCP plugin
 *
 * Provides enhanced tools:
 *   - run_shell   : execute a shell command and capture output
 *   - read_url    : fetch the text content of a URL
 *   - list_processes : list running processes (ps snapshot)
 *   - env_info    : return key environment/system details
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { execSync } from "child_process";
import { readFileSync } from "fs";
import { createRequire } from "module";
import os from "os";

const require = createRequire(import.meta.url);

const TOOLS = [
  {
    name: "run_shell",
    description:
      "Run a shell command and return stdout/stderr. Use for build commands, git ops, or any CLI tool. Commands run in a sandboxed subprocess with a 30 s timeout.",
    inputSchema: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "The shell command to execute.",
        },
        cwd: {
          type: "string",
          description: "Working directory for the command (optional).",
        },
      },
      required: ["command"],
    },
  },
  {
    name: "read_url",
    description:
      "Fetch the raw text content of an HTTP/HTTPS URL. Useful for reading documentation, APIs, or any web resource.",
    inputSchema: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "The URL to fetch.",
        },
      },
      required: ["url"],
    },
  },
  {
    name: "list_processes",
    description: "Return a snapshot of currently running processes.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "env_info",
    description:
      "Return key system and environment details: OS, Node version, CPU, memory, hostname, and relevant env vars.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
];

// ── tool handlers ──────────────────────────────────────────────────────────────

function handleRunShell({ command, cwd }) {
  if (!command || typeof command !== "string") {
    throw new Error("'command' is required and must be a string.");
  }
  const options = { timeout: 30_000, encoding: "utf8" };
  if (cwd) options.cwd = cwd;
  try {
    const stdout = execSync(command, options);
    return { stdout: stdout.trimEnd(), exitCode: 0 };
  } catch (err) {
    return {
      stdout: (err.stdout ?? "").trimEnd(),
      stderr: (err.stderr ?? "").trimEnd(),
      exitCode: err.status ?? 1,
    };
  }
}

async function handleReadUrl({ url }) {
  if (!url || typeof url !== "string") {
    throw new Error("'url' is required and must be a string.");
  }
  const parsed = new URL(url); // validates the URL
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Only http:// and https:// URLs are supported.");
  }
  const res = await fetch(url, {
    headers: { "User-Agent": "superpowers-mcp/1.0" },
    signal: AbortSignal.timeout(15_000),
  });
  const body = await res.text();
  return { status: res.status, body };
}

function handleListProcesses() {
  const raw = execSync("ps aux --no-headers", { encoding: "utf8", timeout: 5_000 });
  const processes = raw
    .trim()
    .split("\n")
    .map((line) => {
      const parts = line.trim().split(/\s+/);
      return {
        user: parts[0],
        pid: parts[1],
        cpu: parts[2],
        mem: parts[3],
        command: parts.slice(10).join(" "),
      };
    });
  return { count: processes.length, processes };
}

function handleEnvInfo() {
  const safeEnvKeys = ["PATH", "HOME", "USER", "SHELL", "TERM", "LANG", "NODE_ENV"];
  const env = {};
  for (const k of safeEnvKeys) {
    if (process.env[k]) env[k] = process.env[k];
  }
  return {
    os: { platform: os.platform(), release: os.release(), arch: os.arch() },
    node: process.version,
    cpu: { model: os.cpus()[0]?.model, cores: os.cpus().length },
    memory: {
      totalMB: Math.round(os.totalmem() / 1024 / 1024),
      freeMB: Math.round(os.freemem() / 1024 / 1024),
    },
    hostname: os.hostname(),
    uptime: os.uptime(),
    env,
  };
}

// ── server setup ───────────────────────────────────────────────────────────────

const server = new Server(
  { name: "superpowers", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  let result;
  switch (name) {
    case "run_shell":
      result = handleRunShell(args ?? {});
      break;
    case "read_url":
      result = await handleReadUrl(args ?? {});
      break;
    case "list_processes":
      result = handleListProcesses();
      break;
    case "env_info":
      result = handleEnvInfo();
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
