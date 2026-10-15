import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import * as fs from "fs/promises";
import * as path from "path";

// Define the sandboxed workspace root directory
const WORKSPACE_ROOT = path.resolve(process.cwd(), "workspace");

// Helper function to validate path and prevent path traversal attacks
async function validatePath(userPath: string): Promise<string> {
  const resolvedPath = path.resolve(WORKSPACE_ROOT, userPath);
  if (resolvedPath !== WORKSPACE_ROOT && !resolvedPath.startsWith(WORKSPACE_ROOT + path.sep)) {
    throw new Error(`Access denied: Path '${userPath}' is outside the sandboxed workspace.`);
  }
  return resolvedPath;
}

// Initialize the MCP Server
const server = new Server(
  {
    name: "mcp-file-server",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Define available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "list_files",
        description: "List files and directories inside the workspace sandbox.",
        inputSchema: {
          type: "object",
          properties: {
            directory: { type: "string", description: "Relative path from workspace root (optional)" }
          }
        }
      },
      {
        name: "read_file",
        description: "Read the contents of a text file.",
        inputSchema: {
          type: "object",
          properties: {
            path: { type: "string", description: "Path to the file to read" }
          },
          required: ["path"]
        }
      },
      {
        name: "write_file",
        description: "Create or overwrite a file with text content.",
        inputSchema: {
          type: "object",
          properties: {
            path: { type: "string", description: "Path to the file to write" },
            content: { type: "string", description: "Text content to write" }
          },
          required: ["path", "content"]
        }
      },
      {
        name: "delete_file",
        description: "Delete a file from the workspace.",
        inputSchema: {
          type: "object",
          properties: {
            path: { type: "string", description: "Path to the file to delete" }
          },
          required: ["path"]
        }
      }
    ]
  };
});

// Handle tool execution requests
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    if (name === "list_files") {
      const relPath = (args?.directory as string) || "";
      const targetPath = await validatePath(relPath);
      const entries = await fs.readdir(targetPath, { withFileTypes: true });
      const result = entries
        .map((e) => `${e.isDirectory() ? "[DIR]" : "[FILE]"} ${e.name}`)
        .join("\n");
      return { content: [{ type: "text", text: result || "Directory is empty." }] };
    }

    if (name === "read_file") {
      const targetPath = await validatePath(args?.path as string);
      const content = await fs.readFile(targetPath, "utf-8");
      return { content: [{ type: "text", text: content }] };
    }

    if (name === "write_file") {
      const targetPath = await validatePath(args?.path as string);
      await fs.writeFile(targetPath, args?.content as string, "utf-8");
      return { content: [{ type: "text", text: `Successfully wrote to ${args?.path}` }] };
    }

    if (name === "delete_file") {
      const targetPath = await validatePath(args?.path as string);
      await fs.unlink(targetPath);
      return { content: [{ type: "text", text: `Successfully deleted ${args?.path}` }] };
    }

    throw new Error(`Unknown tool: ${name}`);
  } catch (error: any) {
    return {
      content: [{ type: "text", text: `Error: ${error.message}` }],
      isError: true,
    };
  }
});

// Start the server using Stdio transport
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("MCP File Server running on stdio");
}

main().catch((error) => {
  console.error("Server fatal error:", error);
  process.exit(1);
});