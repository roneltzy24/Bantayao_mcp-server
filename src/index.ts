import "dotenv/config";
import express, { Request, Response, NextFunction } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import * as fs from "fs/promises";
import { mkdirSync, realpathSync } from "fs";
import * as path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { z } from "zod";

const execFileAsync = promisify(execFile);

// ---------- Config (from environment) ----------
const PORT = Number(process.env.PORT || 3000);
const TOKEN = process.env.MCP_TOKEN;
if (!TOKEN) {
  console.error("MCP_TOKEN is not set. Add it to .env");
  process.exit(1);
}

const WORKSPACE_ROOT = path.resolve(process.env.WORKSPACE_ROOT || path.join(process.cwd(), "workspace"));
mkdirSync(WORKSPACE_ROOT, { recursive: true });
const REAL_ROOT = realpathSync(WORKSPACE_ROOT);
const AUDIT_LOG = path.resolve(process.cwd(), "audit.log");

// ---------- Security helpers ----------
function isInside(child: string, root: string): boolean {
  return child === root || child.startsWith(root + path.sep);
}

// Resolves a user path against the workspace and rejects anything that escapes it,
// including escapes through symlinks.
async function validatePath(userPath: string): Promise<string> {
  const deny = new Error(`Access denied: '${userPath}' is outside the sandboxed workspace.`);
  const resolved = path.resolve(WORKSPACE_ROOT, userPath);
  if (!isInside(resolved, WORKSPACE_ROOT)) throw deny;

  // Check the real location of the path (or its nearest existing parent)
  let probe = resolved;
  for (;;) {
    let real: string | null = null;
    try {
      real = await fs.realpath(probe);
    } catch (e: any) {
      if (e.code !== "ENOENT") throw e;
    }
    if (real !== null) {
      if (!isInside(real, REAL_ROOT)) throw deny;
      break;
    }
    probe = path.dirname(probe);
  }
  return resolved;
}

// Destructive actions are logged here (outside the workspace)
async function audit(action: string, detail: string) {
  const line = `${new Date().toISOString()} ${action} ${detail}\n`;
  await fs.appendFile(AUDIT_LOG, line, "utf-8");
}

// ---------- Tool helpers ----------
const ok = (text: string) => ({ content: [{ type: "text" as const, text }] });
const fail = (e: any) => ({
  content: [{ type: "text" as const, text: `Error: ${e.message}` }],
  isError: true,
});
async function safe(fn: () => Promise<string>) {
  try {
    return ok(await fn());
  } catch (e: any) {
    return fail(e);
  }
}

async function git(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", ["-C", WORKSPACE_ROOT, ...args]);
  return stdout.trim() || "(no output)";
}

async function walk(dir: string, out: string[] = []): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    if (e.name === ".git") continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) await walk(full, out); // symlinks are not followed
    else if (e.isFile()) out.push(full);
  }
  return out;
}

// ---------- MCP server and tools ----------
function createServer(): McpServer {
  const server = new McpServer({ name: "mcp-file-server", version: "2.0.0" });

  server.tool(
    "list_files",
    "List files and directories inside the workspace.",
    { directory: z.string().optional().describe("Relative path from workspace root") },
    async ({ directory }) =>
      safe(async () => {
        const target = await validatePath(directory || "");
        const entries = await fs.readdir(target, { withFileTypes: true });
        return (
          entries.map((e) => `${e.isDirectory() ? "[DIR]" : "[FILE]"} ${e.name}`).join("\n") ||
          "Directory is empty."
        );
      })
  );

  server.tool(
    "read_file",
    "Read the contents of a text file.",
    { path: z.string().describe("Path to the file") },
    async ({ path: p }) =>
      safe(async () => fs.readFile(await validatePath(p), "utf-8"))
  );

  server.tool(
    "write_file",
    "Create or overwrite a file with text content.",
    { path: z.string(), content: z.string() },
    async ({ path: p, content }) =>
      safe(async () => {
        const target = await validatePath(p);
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(target, content, "utf-8");
        await audit("write_file", p);
        return `Successfully wrote to ${p}`;
      })
  );

  server.tool(
    "str_replace",
    "Replace one unique string in a file. Fails if the string is missing or appears more than once.",
    { path: z.string(), old_str: z.string().min(1), new_str: z.string() },
    async ({ path: p, old_str, new_str }) =>
      safe(async () => {
        const target = await validatePath(p);
        const content = await fs.readFile(target, "utf-8");
        const count = content.split(old_str).length - 1;
        if (count === 0) throw new Error("old_str not found in file.");
        if (count > 1) throw new Error(`old_str appears ${count} times. Make it unique.`);
        await fs.writeFile(target, content.replace(old_str, () => new_str), "utf-8");
        await audit("str_replace", p);
        return `Replaced 1 occurrence in ${p}`;
      })
  );

  server.tool(
    "delete_file",
    "Delete a file from the workspace.",
    { path: z.string() },
    async ({ path: p }) =>
      safe(async () => {
        const target = await validatePath(p);
        await fs.unlink(target);
        await audit("delete_file", p);
        return `Successfully deleted ${p}`;
      })
  );

  server.tool(
    "search_files",
    "Search all workspace files for a text string (case-insensitive). Returns path:line:text.",
    { query: z.string().min(1), directory: z.string().optional() },
    async ({ query, directory }) =>
      safe(async () => {
        const base = await validatePath(directory || "");
        const files = await walk(base);
        const needle = query.toLowerCase();
        const hits: string[] = [];
        for (const file of files) {
          const stat = await fs.stat(file);
          if (stat.size > 1_000_000) continue;
          const lines = (await fs.readFile(file, "utf-8")).split("\n");
          lines.forEach((line, i) => {
            if (line.toLowerCase().includes(needle) && hits.length < 100) {
              hits.push(`${path.relative(WORKSPACE_ROOT, file)}:${i + 1}:${line.trim()}`);
            }
          });
        }
        return hits.join("\n") || "No matches.";
      })
  );

  server.tool("git_status", "Show git status of the workspace.", {}, async () =>
    safe(() => git(["status", "--short"]))
  );

  server.tool(
    "git_log",
    "Show recent git commits of the workspace.",
    { count: z.number().int().min(1).max(50).optional() },
    async ({ count }) => safe(() => git(["log", "--oneline", "-n", String(count ?? 10)]))
  );

  server.tool(
    "append_log",
    "Append a timestamped line to a log file (use for PLAN_LOG.md, CHECKPOINTS.md, DECISIONS.md).",
    { path: z.string(), entry: z.string().min(1) },
    async ({ path: p, entry }) =>
      safe(async () => {
        const target = await validatePath(p);
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.appendFile(target, `- ${new Date().toISOString()} ${entry}\n`, "utf-8");
        await audit("append_log", p);
        return `Appended to ${p}`;
      })
  );

  return server;
}

// ---------- HTTP server with token auth ----------
const app = express();
app.use(express.json());

function auth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  const queryToken = typeof req.query.token === "string" ? req.query.token : undefined;
  if (header === `Bearer ${TOKEN}` || queryToken === TOKEN) return next();
  res.status(401).json({ error: "Unauthorized" });
}

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.post("/mcp", auth, async (req, res) => {
  const server = createServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => {
    transport.close();
    server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

app.get("/mcp", (_req, res) => res.status(405).json({ error: "Method not allowed" }));
app.delete("/mcp", (_req, res) => res.status(405).json({ error: "Method not allowed" }));

app.listen(PORT, () => {
  console.log(`MCP File Server listening on http://localhost:${PORT}/mcp`);
});