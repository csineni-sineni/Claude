#!/usr/bin/env node
/**
 * gong — Claude Code MCP plugin
 *
 * Provides tools to interact with the Gong API for contacts and Engage prospecting flows:
 *   - gong_list_contacts         : list contacts with optional email filter and pagination
 *   - gong_add_contacts          : create or update (upsert) one or more contacts
 *   - gong_list_flows            : list available Engage prospecting flows
 *   - gong_add_prospects_to_flow : add contacts as prospects to a specific flow
 *
 * Authentication: set GONG_ACCESS_KEY and GONG_ACCESS_KEY_SECRET environment variables.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const GONG_BASE_URL = "https://api.gong.io";

// ── Auth & HTTP helpers ────────────────────────────────────────────────────────

function getAuthHeader() {
  const key = process.env.GONG_ACCESS_KEY;
  const secret = process.env.GONG_ACCESS_KEY_SECRET;
  if (!key || !secret) {
    throw new Error(
      "Gong credentials not found. Set GONG_ACCESS_KEY and GONG_ACCESS_KEY_SECRET " +
        "environment variables."
    );
  }
  return `Basic ${Buffer.from(`${key}:${secret}`).toString("base64")}`;
}

async function gongFetch(path, { method = "GET", body } = {}) {
  const res = await fetch(`${GONG_BASE_URL}${path}`, {
    method,
    headers: {
      Authorization: getAuthHeader(),
      "Content-Type": "application/json",
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    let message = res.statusText;
    try {
      const err = await res.json();
      message = err.message ?? err.error ?? JSON.stringify(err);
    } catch (_) {
      // ignore JSON parse errors on error body
    }
    throw new Error(`Gong API error ${res.status}: ${message}`);
  }

  return res.json();
}

// ── Tool definitions ───────────────────────────────────────────────────────────

const TOOLS = [
  {
    name: "gong_list_contacts",
    description:
      "List contacts from Gong with optional email address filtering and cursor-based pagination.",
    inputSchema: {
      type: "object",
      properties: {
        emailAddresses: {
          type: "array",
          items: { type: "string" },
          description: "Filter contacts by one or more email addresses.",
        },
        cursor: {
          type: "string",
          description:
            "Pagination cursor returned by a previous call to retrieve the next page.",
        },
      },
      required: [],
    },
  },
  {
    name: "gong_add_contacts",
    description:
      "Create or update (upsert) one or more contacts in Gong. Contacts are matched by email address.",
    inputSchema: {
      type: "object",
      properties: {
        contacts: {
          type: "array",
          description: "Array of contact objects to create or update.",
          items: {
            type: "object",
            properties: {
              emailAddress: {
                type: "string",
                description: "Contact's email address (required, used as the unique key).",
              },
              firstName: { type: "string", description: "Contact's first name." },
              lastName: { type: "string", description: "Contact's last name." },
              title: { type: "string", description: "Contact's job title." },
              company: { type: "string", description: "Contact's company name." },
              phone: { type: "string", description: "Contact's phone number." },
            },
            required: ["emailAddress"],
          },
        },
      },
      required: ["contacts"],
    },
  },
  {
    name: "gong_list_flows",
    description: "List all available Gong Engage prospecting flows.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "gong_add_prospects_to_flow",
    description:
      "Enroll one or more prospects (contacts) into a Gong Engage prospecting flow by flow ID.",
    inputSchema: {
      type: "object",
      properties: {
        flowId: {
          type: "string",
          description:
            "The ID of the Gong Engage flow to add prospects to. Use gong_list_flows to find flow IDs.",
        },
        prospects: {
          type: "array",
          description: "Array of prospect objects to enroll in the flow.",
          items: {
            type: "object",
            properties: {
              emailAddress: {
                type: "string",
                description: "Prospect's email address (required).",
              },
              firstName: { type: "string", description: "Prospect's first name." },
              lastName: { type: "string", description: "Prospect's last name." },
            },
            required: ["emailAddress"],
          },
        },
      },
      required: ["flowId", "prospects"],
    },
  },
];

// ── Tool handlers ──────────────────────────────────────────────────────────────

async function handleGongListContacts({ emailAddresses, cursor } = {}) {
  const qs = new URLSearchParams();
  if (Array.isArray(emailAddresses) && emailAddresses.length > 0) {
    for (const email of emailAddresses) {
      qs.append("emailAddresses", email);
    }
  }
  if (cursor) {
    qs.append("cursor", cursor);
  }
  const query = qs.toString();
  const data = await gongFetch(`/v2/contacts${query ? `?${query}` : ""}`);
  const contacts = data.contacts ?? [];
  return {
    count: contacts.length,
    contacts,
    ...(data.cursor ? { nextPageCursor: data.cursor } : {}),
  };
}

async function handleGongAddContacts({ contacts }) {
  if (!Array.isArray(contacts) || contacts.length === 0) {
    throw new Error("'contacts' must be a non-empty array.");
  }
  for (const c of contacts) {
    if (!c.emailAddress || typeof c.emailAddress !== "string") {
      throw new Error("Each contact must have a non-empty 'emailAddress' string.");
    }
  }
  const data = await gongFetch("/v2/contacts", { method: "PUT", body: { contacts } });
  return data;
}

async function handleGongListFlows() {
  const data = await gongFetch("/v2/flows");
  const flows = (data.flows ?? []).map(({ id, name }) => ({ id, name }));
  return { count: flows.length, flows };
}

async function handleGongAddProspectsToFlow({ flowId, prospects }) {
  if (!flowId || typeof flowId !== "string") {
    throw new Error("'flowId' is required and must be a non-empty string.");
  }
  if (!Array.isArray(prospects) || prospects.length === 0) {
    throw new Error("'prospects' must be a non-empty array.");
  }
  for (const p of prospects) {
    if (!p.emailAddress || typeof p.emailAddress !== "string") {
      throw new Error("Each prospect must have a non-empty 'emailAddress' string.");
    }
  }
  const data = await gongFetch(`/v2/flows/${flowId}/prospects`, {
    method: "POST",
    body: { prospects },
  });
  return data;
}

// ── Server setup ───────────────────────────────────────────────────────────────

const server = new Server(
  { name: "gong", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  let result;
  switch (name) {
    case "gong_list_contacts":
      result = await handleGongListContacts(args ?? {});
      break;
    case "gong_add_contacts":
      result = await handleGongAddContacts(args ?? {});
      break;
    case "gong_list_flows":
      result = await handleGongListFlows();
      break;
    case "gong_add_prospects_to_flow":
      result = await handleGongAddProspectsToFlow(args ?? {});
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
