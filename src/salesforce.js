#!/usr/bin/env node
/**
 * salesforce — Claude Code MCP plugin
 *
 * Provides tools to query and create Salesforce Contact records via REST API:
 *   - salesforce_create_contacts : batch create Contacts (composite/sobjects, up to 25 per request)
 *   - salesforce_query           : run a read-only SOQL query (first page of results)
 *
 * Authentication: set SALESFORCE_INSTANCE_URL and SALESFORCE_ACCESS_TOKEN environment variables.
 * The access token must include the REST API (api) scope for your org.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { pathToFileURL } from "url";
import path from "path";

const API_VERSION = "v59.0";
const COMPOSITE_BATCH_SIZE = 25;

function normalizeInstanceUrl(raw) {
  if (!raw || typeof raw !== "string") {
    return null;
  }
  return raw.replace(/\/+$/, "");
}

function getInstanceUrl() {
  const url = normalizeInstanceUrl(process.env.SALESFORCE_INSTANCE_URL);
  if (!url) {
    throw new Error(
      "Salesforce instance URL not found. Set SALESFORCE_INSTANCE_URL " +
        "(e.g. https://yourdomain.my.salesforce.com)."
    );
  }
  return url;
}

function getAccessToken() {
  const token = process.env.SALESFORCE_ACCESS_TOKEN;
  if (!token || typeof token !== "string") {
    throw new Error(
      "Salesforce access token not found. Set SALESFORCE_ACCESS_TOKEN with a valid OAuth access token."
    );
  }
  return token.trim();
}

function getAuthHeader() {
  return `Bearer ${getAccessToken()}`;
}

async function salesforceFetch(path, { method = "GET", body } = {}) {
  const base = getInstanceUrl();
  const url = `${base}${path.startsWith("/") ? path : `/${path}`}`;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: getAuthHeader(),
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15_000),
  });

  const text = await res.text();
  let payload = text;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    // leave as string
  }

  if (!res.ok) {
    const message =
      typeof payload === "object" && payload !== null
        ? JSON.stringify(payload)
        : text || res.statusText;
    throw new Error(`Salesforce API error ${res.status}: ${message}`);
  }

  return payload;
}

const TOOLS = [
  {
    name: "salesforce_create_contacts",
    description:
      "Create one or more Salesforce Contact records using the composite sobjects API (batches of up to 25). " +
      "Each record must include attributes.type \"Contact\" fields are merged from the provided object (e.g. LastName, Email, FirstName). " +
      "Org-specific required fields may cause per-record failures; check the results array for success/errors per record.",
    inputSchema: {
      type: "object",
      properties: {
        records: {
          type: "array",
          description:
            "Contact field objects. Each object is spread into a record with attributes.type set to Contact. " +
            "Example: { \"LastName\": \"Doe\", \"Email\": \"jane@example.com\" }",
          items: {
            type: "object",
            additionalProperties: true,
          },
          minItems: 1,
        },
      },
      required: ["records"],
    },
  },
  {
    name: "salesforce_query",
    description:
      "Execute a SOQL query via GET /query (read-only). Returns the first page of results. " +
      "If done is false, call again with the same q or use salesforce_query_next with nextRecordsUrl from the previous response.",
    inputSchema: {
      type: "object",
      properties: {
        q: {
          type: "string",
          description: "SOQL query string (e.g. SELECT Id, Email FROM Contact WHERE Email != null LIMIT 10).",
        },
      },
      required: ["q"],
    },
  },
  {
    name: "salesforce_query_next",
    description:
      "Fetch the next page of query results using nextRecordsUrl returned by salesforce_query or a prior salesforce_query_next call.",
    inputSchema: {
      type: "object",
      properties: {
        nextRecordsUrl: {
          type: "string",
          description:
            "Relative URL from the prior query response (e.g. /services/data/v59.0/query/01g...-2000).",
        },
      },
      required: ["nextRecordsUrl"],
    },
  },
];

export async function handleSalesforceCreateContacts({ records }) {
  if (!Array.isArray(records) || records.length === 0) {
    throw new Error("'records' must be a non-empty array.");
  }

  const path = `/services/data/${API_VERSION}/composite/sobjects`;
  const allResults = [];

  for (let i = 0; i < records.length; i += COMPOSITE_BATCH_SIZE) {
    const chunk = records.slice(i, i + COMPOSITE_BATCH_SIZE);
    const body = {
      allOrNone: false,
      records: chunk.map((fields) => {
        if (!fields || typeof fields !== "object" || Array.isArray(fields)) {
          throw new Error("Each record must be a plain object of Contact fields.");
        }
        return {
          attributes: { type: "Contact" },
          ...fields,
        };
      }),
    };

    const data = await salesforceFetch(path, { method: "POST", body });
    if (!Array.isArray(data)) {
      throw new Error("Unexpected Salesforce composite/sobjects response shape.");
    }
    allResults.push(...data);
  }

  return {
    totalRequested: records.length,
    results: allResults,
  };
}

export async function handleSalesforceQuery({ q }) {
  if (!q || typeof q !== "string") {
    throw new Error("'q' is required and must be a non-empty SOQL string.");
  }
  const path = `/services/data/${API_VERSION}/query?q=${encodeURIComponent(q)}`;
  return salesforceFetch(path);
}

export async function handleSalesforceQueryNext({ nextRecordsUrl }) {
  if (!nextRecordsUrl || typeof nextRecordsUrl !== "string") {
    throw new Error("'nextRecordsUrl' is required and must be a non-empty string.");
  }
  const trimmed = nextRecordsUrl.trim();
  const path = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return salesforceFetch(path);
}

const server = new Server(
  { name: "salesforce", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  let result;
  switch (name) {
    case "salesforce_create_contacts":
      result = await handleSalesforceCreateContacts(args ?? {});
      break;
    case "salesforce_query":
      result = await handleSalesforceQuery(args ?? {});
      break;
    case "salesforce_query_next":
      result = await handleSalesforceQueryNext(args ?? {});
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
