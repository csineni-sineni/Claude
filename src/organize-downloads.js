#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import fs from "fs";
import path from "path";
import os from "os";

const CATEGORIES = {
  Images: [".jpg", ".jpeg", ".png", ".gif", ".bmp", ".svg", ".webp", ".ico", ".tiff", ".heic"],
  Documents: [".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".txt", ".csv", ".odt", ".rtf", ".md"],
  Videos: [".mp4", ".avi", ".mov", ".mkv", ".wmv", ".flv", ".webm", ".m4v", ".mpg", ".mpeg"],
  Audio: [".mp3", ".wav", ".flac", ".aac", ".ogg", ".m4a", ".wma", ".opus"],
  Archives: [".zip", ".tar", ".gz", ".rar", ".7z", ".bz2", ".xz", ".dmg", ".iso"],
  Code: [".js", ".py", ".ts", ".java", ".cpp", ".c", ".h", ".cs", ".go", ".rs", ".rb", ".php", ".swift", ".kt", ".json", ".yaml", ".yml", ".sh"],
};

const EXT_TO_CATEGORY = {};
for (const [category, exts] of Object.entries(CATEGORIES)) {
  for (const ext of exts) {
    EXT_TO_CATEGORY[ext] = category;
  }
}

function categorize(filename) {
  const ext = path.extname(filename).toLowerCase();
  return EXT_TO_CATEGORY[ext] ?? "Others";
}

function getFiles(folder) {
  const entries = fs.readdirSync(folder, { withFileTypes: true });
  return entries.filter((e) => e.isFile());
}

function resolveFolder(folder) {
  return folder ? path.resolve(folder) : path.join(os.homedir(), "Downloads");
}

const TOOLS = [
  {
    name: "list_downloads",
    description:
      "List files in the Downloads folder along with their detected category (Images, Documents, Videos, Audio, Archives, Code, Others).",
    inputSchema: {
      type: "object",
      properties: {
        folder: {
          type: "string",
          description: "Path to the downloads folder. Defaults to ~/Downloads.",
        },
      },
      required: [],
    },
  },
  {
    name: "organize_downloads",
    description:
      "Move files in the Downloads folder into category subdirectories (Images, Documents, Videos, etc.). Set dry_run to true to preview without making changes.",
    inputSchema: {
      type: "object",
      properties: {
        folder: {
          type: "string",
          description: "Path to the downloads folder. Defaults to ~/Downloads.",
        },
        dry_run: {
          type: "boolean",
          description: "If true, show what would be moved without actually moving files. Defaults to false.",
        },
      },
      required: [],
    },
  },
  {
    name: "get_download_stats",
    description:
      "Return statistics for the Downloads folder: file counts and total size per category.",
    inputSchema: {
      type: "object",
      properties: {
        folder: {
          type: "string",
          description: "Path to the downloads folder. Defaults to ~/Downloads.",
        },
      },
      required: [],
    },
  },
];

// ── handlers ───────────────────────────────────────────────────────────────────

function handleListDownloads({ folder } = {}) {
  const dir = resolveFolder(folder);
  if (!fs.existsSync(dir)) {
    return { folder: dir, error: "Folder does not exist.", files: [] };
  }
  const files = getFiles(dir).map((e) => {
    const stat = fs.statSync(path.join(dir, e.name));
    const category = categorize(e.name);
    return {
      name: e.name,
      category,
      extension: path.extname(e.name).toLowerCase() || "(none)",
      sizeBytes: stat.size,
    };
  });
  return { folder: dir, count: files.length, files };
}

function handleOrganizeDownloads({ folder, dry_run = false } = {}) {
  const dir = resolveFolder(folder);
  if (!fs.existsSync(dir)) {
    return { folder: dir, error: "Folder does not exist.", operations: [] };
  }
  const files = getFiles(dir);
  const operations = [];

  for (const entry of files) {
    const category = categorize(entry.name);
    const destDir = path.join(dir, category);
    const src = path.join(dir, entry.name);
    const dest = path.join(destDir, entry.name);

    if (!dry_run) {
      if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true });
      }
      fs.renameSync(src, dest);
    }

    operations.push({
      file: entry.name,
      category,
      from: src,
      to: dest,
      status: dry_run ? "would move" : "moved",
    });
  }

  return {
    folder: dir,
    dry_run,
    total: operations.length,
    operations,
  };
}

function handleGetDownloadStats({ folder } = {}) {
  const dir = resolveFolder(folder);
  if (!fs.existsSync(dir)) {
    return { folder: dir, error: "Folder does not exist.", stats: {} };
  }
  const files = getFiles(dir);
  const stats = {};

  for (const entry of files) {
    const category = categorize(entry.name);
    const stat = fs.statSync(path.join(dir, entry.name));
    if (!stats[category]) {
      stats[category] = { count: 0, totalBytes: 0 };
    }
    stats[category].count += 1;
    stats[category].totalBytes += stat.size;
  }

  return {
    folder: dir,
    totalFiles: files.length,
    stats,
  };
}

// ── server setup ───────────────────────────────────────────────────────────────

const server = new Server(
  { name: "organize-downloads", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  let result;
  switch (name) {
    case "list_downloads":
      result = handleListDownloads(args ?? {});
      break;
    case "organize_downloads":
      result = handleOrganizeDownloads(args ?? {});
      break;
    case "get_download_stats":
      result = handleGetDownloadStats(args ?? {});
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
