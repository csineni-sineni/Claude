#!/usr/bin/env node
/**
 * gmail-inbox — Claude Code MCP plugin
 *
 * Provides tools to authenticate with Gmail and scan the inbox for emails
 * from real people that are waiting on a response.
 *
 * Tools:
 *   - gmail_setup_auth    : generate the OAuth2 authorization URL
 *   - gmail_complete_auth : exchange an auth code for tokens and save them
 *   - scan_inbox          : scan inbox and return only actionable emails
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { google } from "googleapis";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TOKEN_PATH = join(__dirname, "..", ".gmail-token.json");
const CREDENTIALS_PATH = join(__dirname, "..", ".gmail-credentials.json");

// Gmail OAuth2 scopes — read-only is sufficient
const SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"];

// Sender local-part patterns that indicate automated/system senders
const AUTOMATED_SENDER_RE =
  /^(noreply|no[_.-]?reply|do[_.-]?not[_.-]?reply|notifications?|alert(s|ing)?|mailer|newsletter|updates?|info|support|hello|team|postmaster|bounce(s|d)?|daemon|admin|automated?|system|service|robot|bot|feedback|news|digest|promo|deals?|offer|marketing|billing|invoice|receipt|confirm|verify|security|account|notify|do-not-reply|donotreply)/i;

// Header values on `Precedence` that indicate bulk/list mail
const BULK_PRECEDENCE = new Set(["bulk", "list", "junk"]);

const TOOLS = [
  {
    name: "gmail_setup_auth",
    description:
      "Generate the Google OAuth2 authorization URL. Visit the URL, grant access, then copy the code and call gmail_complete_auth. Reads GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET from environment variables or .gmail-credentials.json.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "gmail_complete_auth",
    description:
      "Exchange the OAuth2 authorization code for access/refresh tokens and save them locally. Call this after gmail_setup_auth.",
    inputSchema: {
      type: "object",
      properties: {
        code: {
          type: "string",
          description: "The authorization code from the OAuth2 redirect URL.",
        },
      },
      required: ["code"],
    },
  },
  {
    name: "scan_inbox",
    description:
      "Scan the Gmail inbox and return only emails from real people that appear to be waiting on a response. Skips newsletters, automated messages, calendar invites, mailing lists, and threads where you already replied last.",
    inputSchema: {
      type: "object",
      properties: {
        max_results: {
          type: "integer",
          description: "Maximum number of inbox messages to evaluate (default: 50).",
        },
        days_back: {
          type: "integer",
          description: "How many days back to look (default: 7).",
        },
      },
      required: [],
    },
  },
];

// ── OAuth2 helpers ─────────────────────────────────────────────────────────────

function loadCredentials() {
  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;

  if (clientId && clientSecret) {
    return { clientId, clientSecret };
  }

  if (existsSync(CREDENTIALS_PATH)) {
    const raw = JSON.parse(readFileSync(CREDENTIALS_PATH, "utf8"));
    // Support both raw { client_id, client_secret } and the Google JSON download format
    const installed = raw.installed ?? raw.web ?? raw;
    return {
      clientId: installed.client_id,
      clientSecret: installed.client_secret,
    };
  }

  throw new Error(
    "Gmail credentials not found. Set GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET " +
      "environment variables, or place a .gmail-credentials.json file in the project root."
  );
}

function createOAuth2Client() {
  const { clientId, clientSecret } = loadCredentials();
  return new google.auth.OAuth2(clientId, clientSecret, "urn:ietf:wg:oauth:2.0:oob");
}

function loadSavedToken(oauth2Client) {
  if (!existsSync(TOKEN_PATH)) return false;
  const token = JSON.parse(readFileSync(TOKEN_PATH, "utf8"));
  oauth2Client.setCredentials(token);
  return true;
}

function saveToken(oauth2Client) {
  writeFileSync(TOKEN_PATH, JSON.stringify(oauth2Client.credentials, null, 2));
}

function getAuthenticatedClient() {
  const oauth2Client = createOAuth2Client();
  if (!loadSavedToken(oauth2Client)) {
    throw new Error(
      "Not authenticated. Call gmail_setup_auth first, visit the URL, then call gmail_complete_auth with the code."
    );
  }
  // Auto-refresh if token is expired
  oauth2Client.on("tokens", (tokens) => {
    if (tokens.refresh_token) {
      oauth2Client.credentials = { ...oauth2Client.credentials, ...tokens };
    } else {
      oauth2Client.credentials = { ...oauth2Client.credentials, ...tokens };
    }
    saveToken(oauth2Client);
  });
  return oauth2Client;
}

// ── tool handlers ──────────────────────────────────────────────────────────────

function handleGmailSetupAuth() {
  const oauth2Client = createOAuth2Client();
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    prompt: "consent",
  });
  return {
    message:
      "Visit the URL below to authorize Gmail access. After granting permission, " +
      "you will be shown a code — copy it and call gmail_complete_auth with that code.",
    auth_url: authUrl,
  };
}

async function handleGmailCompleteAuth({ code }) {
  if (!code || typeof code !== "string") {
    throw new Error("'code' is required.");
  }
  const oauth2Client = createOAuth2Client();
  const { tokens } = await oauth2Client.getToken(code);
  oauth2Client.setCredentials(tokens);
  saveToken(oauth2Client);
  return {
    message: "Authentication successful. Token saved. You can now call scan_inbox.",
  };
}

// ── filtering helpers ──────────────────────────────────────────────────────────

function getHeader(headers, name) {
  return (
    headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? ""
  );
}

function isAutomated(headers) {
  // Skip if List-Unsubscribe header present (newsletter / mailing list)
  if (getHeader(headers, "List-Unsubscribe")) return true;

  // Skip bulk/list/junk precedence
  const precedence = getHeader(headers, "Precedence").toLowerCase();
  if (BULK_PRECEDENCE.has(precedence)) return true;

  // Skip auto-submitted messages
  const autoSubmitted = getHeader(headers, "Auto-Submitted").toLowerCase();
  if (autoSubmitted && autoSubmitted !== "no") return true;

  // Skip auto-replies / out-of-office
  if (getHeader(headers, "X-Autoreply")) return true;
  if (getHeader(headers, "X-Auto-Response-Suppress")) return true;

  // Skip calendar invites
  const contentType = getHeader(headers, "Content-Type").toLowerCase();
  if (contentType.includes("text/calendar") || contentType.includes("vcalendar")) {
    return true;
  }

  return false;
}

function isAutomatedSender(fromHeader) {
  // Extract the local part of the email address
  const match = fromHeader.match(/<([^>]+)>/) ?? fromHeader.match(/(\S+@\S+)/);
  if (!match) return false;
  const address = match[1].toLowerCase();
  const localPart = address.split("@")[0];
  return AUTOMATED_SENDER_RE.test(localPart);
}

function extractFrom(fromHeader) {
  return fromHeader || "(unknown sender)";
}

function parseDate(internalDate) {
  return new Date(parseInt(internalDate, 10)).toISOString();
}

async function handleScanInbox({ max_results = 50, days_back = 7 } = {}) {
  const auth = getAuthenticatedClient();
  const gmail = google.gmail({ version: "v1", auth });

  // Get the authenticated user's email address (used to detect own replies)
  const profileRes = await gmail.users.getProfile({ userId: "me" });
  const myEmail = profileRes.data.emailAddress.toLowerCase();

  // Build query: inbox only, within the date window, skip Gmail's own bulk categories
  const query = [
    "in:inbox",
    `newer_than:${days_back}d`,
    "-category:promotions",
    "-category:updates",
    "-category:social",
    "-category:forums",
  ].join(" ");

  // Fetch message IDs
  const listRes = await gmail.users.messages.list({
    userId: "me",
    q: query,
    maxResults: max_results,
  });

  const messageRefs = listRes.data.messages ?? [];
  if (messageRefs.length === 0) {
    return { count: 0, emails: [] };
  }

  // Fetch full message details in parallel (batches of 10)
  const actionable = [];

  const chunks = [];
  for (let i = 0; i < messageRefs.length; i += 10) {
    chunks.push(messageRefs.slice(i, i + 10));
  }

  for (const chunk of chunks) {
    const messages = await Promise.all(
      chunk.map((ref) =>
        gmail.users.messages.get({
          userId: "me",
          id: ref.id,
          format: "metadata",
          metadataHeaders: [
            "From",
            "Subject",
            "Date",
            "Content-Type",
            "List-Unsubscribe",
            "Precedence",
            "Auto-Submitted",
            "X-Autoreply",
            "X-Auto-Response-Suppress",
          ],
        })
      )
    );

    for (const res of messages) {
      const msg = res.data;
      const headers = msg.payload?.headers ?? [];
      const labels = msg.labelIds ?? [];

      // Skip automated / bulk / calendar messages
      if (isAutomated(headers)) continue;

      const fromHeader = getHeader(headers, "From");
      if (isAutomatedSender(fromHeader)) continue;

      // Skip if the thread's last reply is from us (already responded)
      // We check the thread to find the most recent message sender
      const threadRes = await gmail.users.threads.get({
        userId: "me",
        id: msg.threadId,
        format: "metadata",
        metadataHeaders: ["From"],
      });
      const threadMessages = threadRes.data.messages ?? [];
      const lastMsg = threadMessages[threadMessages.length - 1];
      const lastFrom = getHeader(lastMsg?.payload?.headers ?? [], "From");
      const lastFromEmail = (
        lastFrom.match(/<([^>]+)>/) ?? lastFrom.match(/(\S+@\S+)/)
      )?.[1]?.toLowerCase();
      if (lastFromEmail === myEmail) continue;

      actionable.push({
        from: extractFrom(fromHeader),
        subject: getHeader(headers, "Subject") || "(no subject)",
        date: parseDate(msg.internalDate),
        snippet: msg.snippet ?? "",
        thread_id: msg.threadId,
        unread: labels.includes("UNREAD"),
      });
    }
  }

  // Sort newest first
  actionable.sort((a, b) => new Date(b.date) - new Date(a.date));

  return {
    count: actionable.length,
    emails: actionable,
  };
}

// ── server setup ───────────────────────────────────────────────────────────────

const server = new Server(
  { name: "gmail-inbox", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  let result;
  switch (name) {
    case "gmail_setup_auth":
      result = handleGmailSetupAuth();
      break;
    case "gmail_complete_auth":
      result = await handleGmailCompleteAuth(args ?? {});
      break;
    case "scan_inbox":
      result = await handleScanInbox(args ?? {});
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
