# MCP File Server Connector

A secure, sandboxed Model Context Protocol (MCP) file server connector built with Node.js, TypeScript, and PM2.

## Features
- **Workspace Sandboxing**: Restricts file system operations strictly to `./workspace` using path verification (`path.resolve` and `startsWith`) to prevent path traversal attacks.
- **MCP Tools Implemented**:
  - `list_files`: Lists files and subdirectories inside the workspace sandbox.
  - `read_file`: Reads text file contents.
  - `write_file`: Creates or overwrites files with specified text content.
  - `delete_file`: Deletes specified files securely inside the workspace sandbox.
- **Process Management**: Server execution managed and monitored via PM2.

## Prerequisites & Installation
1. Install dependencies:
   ```cmd
   npm install