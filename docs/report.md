# MCP File Server: Short Report

Author: Ronel L. Bantayao | Course: BSCS 3B | Date: 16 Oct 2026

## 1. Summary

I built a sandboxed MCP file-server connector that exposes 9 tools over
Streamable HTTP. It is protected by a token, kept alive by PM2, and published
through an ngrok tunnel. Claude connected to it as a real MCP client, and I
ran a multi-step task across two separate sessions using handoff files for
shared memory.

## 2. Stack and architecture

| Layer | Choice | Reason |
|---|---|---|
| Runtime and SDK | Node.js + official TypeScript MCP SDK | Reference stack with typed tool definitions |
| Transport | Streamable HTTP via Express | A remote client cannot reach a stdio server, and PM2 gives stdio no stdin |
| Validation | zod | Every tool input is schema-checked before it runs |
| Exposure | ngrok static dev domain | Free, stable HTTPS URL |
| Process manager | PM2 | Automatic restart after a crash |
| Version control | git (host repo plus a separate repo in `workspace/`) | Agent edits get their own history, and `git_status` / `git_log` show only agent work |
| Testing | MCP Inspector, then Claude | Local checks first, then a real client |

The code is a single file, `src/index.ts`, with configuration in environment
variables (`MCP_TOKEN`, `PORT`) loaded from a gitignored `.env`. The server is
stateless: it creates a fresh MCP server per request, so a restart loses
nothing. PM2 restarted the server after I killed its process with `taskkill`.
On Windows `pm2 startup` is not supported, so after a reboot I rely on
`pm2 resurrect`.

## 3. Tool design

- **Small, single-purpose tools.** Nine tools: `list_files`, `read_file`,
  `write_file`, `str_replace`, `delete_file`, `search_files`, `git_status`,
  `git_log`, `append_log`.
- **`str_replace` guards against bad writes.** It fails if the target string
  is missing or appears more than once, so an agent cannot silently change
  the wrong text. I saw this fail correctly during testing.
- **`append_log` supports handoffs.** It adds timestamped lines to
  `PLAN_LOG.md`, `CHECKPOINTS.md` and `DECISIONS.md` without rewriting them.
- **Git-lite tools are read-only.** They use `execFile` with fixed arguments
  rather than a shell, so agent input is never run as a command.
- **Errors are returned, not thrown.** Tools return `isError` results with a
  clear message, so the agent can read the problem and recover.

## 4. Security and tradeoffs

**Controls in place**
- **Sandbox root.** Every path is resolved against `workspace/`. `../package.json`,
  `..\..\Windows\win.ini` and absolute paths were all rejected with "Access denied".
- **Symlink check.** The real path of the target, or its nearest existing
  parent, must also sit inside the real workspace root.
- **Token auth.** `/mcp` requires a Bearer header or `?token=`. A request
  without it returned `{"error":"Unauthorized"}`, locally and through the tunnel.
- **Audit log.** Successful `write_file`, `str_replace`, `delete_file` and
  `append_log` calls are written to `audit.log`, which sits outside the
  workspace so agents cannot edit their own audit trail.
- **Secrets handling.** The token lives in `.env`, which is gitignored. I
  rotated the ngrok authtoken after it appeared in screenshots, and I rotate
  `MCP_TOKEN` before demos.

**Tradeoffs I accepted**
- **Token in the URL.** Claude's custom connector has no header field, so the
  query-string token is what it can use. It can leak into logs and screenshots.
- **Public tunnel.** Anyone who finds the URL can try the endpoint. The token
  is the only barrier, and there is no rate limiting.
- **Logged, not gated.** Destructive actions are recorded but not blocked or
  confirmed by the server. The client's approval prompt is the only gate.
- **Symlink race.** The check runs before the file operation, so a symlink
  created in between could still slip through. It is not a full defense.
- **Cosmetic leak.** `list_files` shows the `.git` folder inside the workspace.
- **Browser clients.** The Inspector could not connect to the public URL
  ("Failed to fetch"), which I believe is browser CORS since the server has
  no CORS headers. Claude connects server-side, so it was unaffected.

## 5. What the demo showed

- **Session 1** read the empty state, created `PROJECT_STATE.md`,
  `CHECKPOINTS.md`, `DECISIONS.md` and `notes/todo.md`, and logged its plan.
- **Session 2**, a fresh chat with no memory, read the handoff files,
  searched the workspace, checked `git_status`, and logged a checkpoint and
  a decision. It declined to tick two todo items because it could not verify
  them, which is the behavior the handoff protocol is meant to produce.

Evidence (transcript, cropped screenshots, handoff copies, `audit.log`) is in
`evidence/`.

## 6. What I would do next

- `if_version` locking on writes to prevent lost updates between agents.
- A `search_code` tool or repo map for larger workspaces.
- Automated path-traversal tests, instead of manual Inspector checks.
- Rate limiting and a request log on the HTTP endpoint.