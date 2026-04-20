#!/usr/bin/env node
/**
 * gong — Claude Code MCP plugin
 *
 * Provides tools to interact with the Gong API for contacts and Engage prospecting flows:
 *   - gong_list_contacts         : list contacts with optional email filter and pagination
 *   - gong_add_contacts          : create or update (upsert) one or more contacts
 *   - gong_list_flows            : list available Engage prospecting flows
 *   - gong_add_prospects_to_flow : assign CRM prospects to an Engage flow (POST /v2/flows/prospects/assign)
 *
 * Authentication: set GONG_ACCESS_KEY and GONG_ACCESS_KEY_SECRET environment variables.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { pathToFileURL } from "url";
import path from "path";

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
      "Assign Salesforce (or other CRM) prospects to a Gong Engage flow by CRM record ID. " +
      "Requires the Gong user's email as flow instance owner (handles flow to-dos). Up to 100 CRM IDs per request. " +
      "Use Salesforce Contact Id values from salesforce_create_contacts or salesforce_query after contacts exist in CRM and sync to Gong.",
    inputSchema: {
      type: "object",
      properties: {
        flowId: {
          type: "string",
          description:
            "The Gong Engage flow ID. Use gong_list_flows to list available flows.",
        },
        crmProspectsIds: {
          type: "array",
          description:
            "CRM prospect IDs (e.g. Salesforce Contact Id like 003xx00000xxxx). Maximum 100 per request.",
          items: { type: "string" },
          minItems: 1,
          maxItems: 100,
        },
        flowInstanceOwnerEmail: {
          type: "string",
          description:
            "Email of the Gong user who owns the flow instance (assigned to flow to-dos).",
        },
        overrides: {
          type: "object",
          description:
            "Optional Engage overrides: steps (subject/body per step number), flowInstanceVariables, coolOffOverride.",
          additionalProperties: true,
        },
        flowInstanceDescription: {
          type: "string",
          description: "Optional flow instance description (Beta in Gong API).",
        },
      },
      required: ["flowId", "crmProspectsIds", "flowInstanceOwnerEmail"],
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

export async function handleGongAddProspectsToFlow({
  flowId,
  crmProspectsIds,
  flowInstanceOwnerEmail,
  overrides,
  flowInstanceDescription,
}) {
  if (!flowId || typeof flowId !== "string") {
    throw new Error("'flowId' is required and must be a non-empty string.");
  }
  if (!flowInstanceOwnerEmail || typeof flowInstanceOwnerEmail !== "string") {
    throw new Error(
      "'flowInstanceOwnerEmail' is required and must be a non-empty string."
    );
  }
  if (!Array.isArray(crmProspectsIds) || crmProspectsIds.length === 0) {
    throw new Error("'crmProspectsIds' must be a non-empty array.");
  }
  if (crmProspectsIds.length > 100) {
    throw new Error("'crmProspectsIds' cannot exceed 100 IDs per request.");
  }
  for (const id of crmProspectsIds) {
    if (!id || typeof id !== "string") {
      throw new Error("Each CRM prospect ID must be a non-empty string.");
    }
  }

  const body = {
    flowId,
    crmProspectsIds,
    flowInstanceOwnerEmail,
  };
  if (overrides !== undefined) {
    body.overrides = overrides;
  }
  if (flowInstanceDescription !== undefined) {
    body.flowInstanceDescription = flowInstanceDescription;
  }

  return gongFetch("/v2/flows/prospects/assign", {
    method: "POST",
    body,
  });
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

const isDirectRun =
  Boolean(process.argv[1]) &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isDirectRun) {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
