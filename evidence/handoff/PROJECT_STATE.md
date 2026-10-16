# Project State

_Last updated: 2026-10-16_

## Goal
Build and deploy a sandboxed MCP file-server connector, then prove it with a
multi-step task across more than one agent session.

## Current Status
- **Server:** Node.js + TypeScript using the official MCP SDK, with zod validation on every tool input.
- **Tools (9):** list_files, read_file, write_file, str_replace, delete_file,
  search_files, git_status, git_log, append_log.
- **Transport:** Streamable HTTP at /mcp, with token authentication.
  Requests without a valid token return 401.
- **Sandbox:** every path is resolved against workspace/, with a symlink check.
  Escape attempts (../package.json, absolute paths) are rejected.
- **Audit:** write_file, str_replace, delete_file and append_log are logged to audit.log.
- **Process manager:** PM2 is running the server and restarts it after a crash (tested with taskkill).
- **Tunnel:** ngrok static dev domain is live and /health returns ok over HTTPS.
- **Client:** Claude custom connector tested; it listed workspace files through the tunnel.
- **Sessions:** session 1 created the handoff files; session 2 read them in a fresh chat,
  logged its work, and refused to tick todo items it could not verify.

## What's Left
1. Finish README.md (setup, run, expose, connect, tool list, security notes).
2. Write the short report: stack, tool design, security tradeoffs.
3. Rotate MCP_TOKEN, restart PM2 with --update-env, and update the connector URL.
4. Clean up the stray src/evidence folder; keep evidence in the root evidence/ folder.
5. Rehearse the 5-minute live demo.

## Known Tradeoffs
- The token is passed in the URL query string and can leak into logs.
- The tunnel is public, and there is no rate limiting.
- list_files also shows the .git folder inside workspace/.

## Next Step
Write the README, then the report.