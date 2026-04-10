#!/usr/bin/env node
/**
 * connect-apps — Claude Code MCP plugin
 *
 * Provides tools for managing and calling named HTTP app connections:
 *   - list_connections  : list all saved named connections
 *   - add_connection    : add or update a named connection
 *   - remove_connection : delete a named connection
 *   - http_request      : make an HTTP request to a named connection
 *   - test_connection   : verify a named connection is reachable
 *
 * Connections are stored in ~/.claude/connect-apps-connections.json
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import os from "os";

// ── connection store ───────────────────────────────────────────────────────────

const CONNECTIONS_DIR = join(os.homedir(), ".claude");
const CONNECTIONS_FILE = join(CONNECTIONS_DIR, "connect-apps-connections.json");

function loadConnections() {
  try {
    return JSON.parse(readFileSync(CONNECTIONS_FILE, "utf8"));
  } catch {
    return {};
  }
}

function saveConnections(connections) {
  mkdirSync(CONNECTIONS_DIR, { recursive: true });
  writeFileSync(CONNECTIONS_FILE, JSON.stringify(connections, null, 2), "utf8");
}

// ── tool definitions ───────────────────────────────────────────────────────────

const TOOLS = [
  {
    name: "list_connections",
    description:
      "List all saved named app connections. Returns each connection's name and base URL (headers are omitted for security).",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "add_connection",
    description:
      "Add or update a named connection. Stores a base URL and optional default headers (e.g. auth tokens) that are sent with every request to that connection.",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Unique name for this connection (e.g. 'github', 'my-api').",
        },
        base_url: {
          type: "string",
          description: "Base URL for the app/API (e.g. 'https://api.github.com').",
        },
        headers: {
          type: "object",
          description:
            "Optional default headers sent with every request (e.g. { \"Authorization\": \"Bearer TOKEN\" }).",
          additionalProperties: { type: "string" },
        },
      },
      required: ["name", "base_url"],
    },
  },
  {
    name: "remove_connection",
    description: "Delete a named connection by name.",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Name of the connection to remove.",
        },
      },
      required: ["name"],
    },
  },
  {
    name: "http_request",
    description:
      "Make an HTTP request to a named connection. Merges the connection's saved headers with any per-call headers you provide.",
    inputSchema: {
      type: "object",
      properties: {
        connection: {
          type: "string",
          description: "Name of the saved connection to use.",
        },
        path: {
          type: "string",
          description: "Path to append to the connection's base URL (e.g. '/users/me'). Defaults to '/'.",
        },
        method: {
          type: "string",
          enum: ["GET", "POST", "PUT", "PATCH", "DELETE"],
          description: "HTTP method. Defaults to 'GET'.",
        },
        body: {
          type: "string",
          description: "Request body as a string (e.g. JSON). Only used for POST/PUT/PATCH.",
        },
        headers: {
          type: "object",
          description: "Additional per-request headers that override the connection defaults.",
          additionalProperties: { type: "string" },
        },
      },
      required: ["connection"],
    },
  },
  {
    name: "test_connection",
    description:
      "Test whether a named connection is reachable by sending a GET request to its base URL. Returns the HTTP status code and response time.",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Name of the connection to test.",
        },
      },
      required: ["name"],
    },
  },
];

// ── tool handlers ──────────────────────────────────────────────────────────────

function handleListConnections() {
  const connections = loadConnections();
  const entries = Object.entries(connections).map(([name, cfg]) => ({
    name,
    base_url: cfg.base_url,
    has_headers: Object.keys(cfg.headers ?? {}).length > 0,
  }));
  return { count: entries.length, connections: entries };
}

function handleAddConnection({ name, base_url, headers }) {
  if (!name || typeof name !== "string") throw new Error("'name' is required.");
  if (!base_url || typeof base_url !== "string") throw new Error("'base_url' is required.");
  new URL(base_url); // validate
  const connections = loadConnections();
  connections[name] = { base_url: base_url.replace(/\/$/, ""), headers: headers ?? {} };
  saveConnections(connections);
  return { ok: true, name, base_url: connections[name].base_url };
}

function handleRemoveConnection({ name }) {
  if (!name || typeof name !== "string") throw new Error("'name' is required.");
  const connections = loadConnections();
  if (!(name in connections)) throw new Error(`Connection '${name}' not found.`);
  delete connections[name];
  saveConnections(connections);
  return { ok: true, removed: name };
}

async function handleHttpRequest({ connection, path = "/", method = "GET", body, headers = {} }) {
  if (!connection) throw new Error("'connection' is required.");
  const connections = loadConnections();
  const cfg = connections[connection];
  if (!cfg) throw new Error(`Connection '${connection}' not found. Use add_connection first.`);

  const url = cfg.base_url + (path.startsWith("/") ? path : "/" + path);
  const mergedHeaders = { "User-Agent": "connect-apps-mcp/1.0", ...cfg.headers, ...headers };

  const fetchOptions = {
    method,
    headers: mergedHeaders,
    signal: AbortSignal.timeout(30_000),
  };
  if (body && ["POST", "PUT", "PATCH"].includes(method)) {
    fetchOptions.body = body;
    if (!mergedHeaders["Content-Type"]) {
      fetchOptions.headers["Content-Type"] = "application/json";
    }
  }

  const res = await fetch(url, fetchOptions);
  const text = await res.text();
  let responseBody;
  try {
    responseBody = JSON.parse(text);
  } catch {
    responseBody = text;
  }
  return { status: res.status, ok: res.ok, url, body: responseBody };
}

async function handleTestConnection({ name }) {
  if (!name) throw new Error("'name' is required.");
  const connections = loadConnections();
  const cfg = connections[name];
  if (!cfg) throw new Error(`Connection '${name}' not found.`);

  const start = Date.now();
  let status, ok, error;
  try {
    const res = await fetch(cfg.base_url, {
      method: "GET",
      headers: { "User-Agent": "connect-apps-mcp/1.0", ...cfg.headers },
      signal: AbortSignal.timeout(10_000),
    });
    status = res.status;
    ok = res.ok;
  } catch (err) {
    error = err.message;
    ok = false;
  }
  return { name, base_url: cfg.base_url, ok, status, error, elapsed_ms: Date.now() - start };
}

// ── server setup ───────────────────────────────────────────────────────────────

const server = new Server(
  { name: "connect-apps", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  let result;
  switch (name) {
    case "list_connections":
      result = handleListConnections();
      break;
    case "add_connection":
      result = handleAddConnection(args ?? {});
      break;
    case "remove_connection":
      result = handleRemoveConnection(args ?? {});
      break;
    case "http_request":
      result = await handleHttpRequest(args ?? {});
      break;
    case "test_connection":
      result = await handleTestConnection(args ?? {});
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
