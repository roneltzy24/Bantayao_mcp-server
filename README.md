# MCP File Server Connector

A sandboxed Model Context Protocol (MCP) file server. It exposes 9 tools over
Streamable HTTP, is protected by a token, runs under PM2, and is published
through an ngrok tunnel so a real MCP client (Claude) can use it.

## Stack

| Layer | Choice | Why |
|---|---|---|
| Runtime and SDK | Node.js + official TypeScript MCP SDK | Reference stack, typed tool definitions |
| Transport | Streamable HTTP (Express) | Works with remote clients; stdio can't be tunneled or run under PM2 |
| Validation | zod | Every tool input is schema-checked |
| Exposure | ngrok with a static dev domain | Free, stable HTTPS URL |
| Process manager | PM2 | Restarts the server after a crash |
| Version control | git | Workspace has its own repo for agent history |
| Testing | MCP Inspector, then Claude | Local checks first, then a real client |

## Prerequisites

- Node.js 20+ and npm
- git
- PM2: `npm install -g pm2`
- ngrok account and the ngrok agent

## Setup

```
git clone <your-repo-url>
cd mcp-file-server
npm install
```

Create `.env` in the project root (no quotes, no spaces around `=`):

```
MCP_TOKEN=<long-random-string>
PORT=3000
```

Generate a token:

```
node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
```

Create the sandbox and give it its own git repo:

```
mkdir workspace
cd workspace
git init
git add .
git commit -m "init workspace"
cd ..
```

Build:

```
npm run build
```

## Run

Under PM2 (keeps it alive and restarts it on a crash):

```
pm2 start ecosystem.config.cjs
pm2 save
pm2 status
```

Health check:

```
curl http://localhost:3000/health
```

On Windows, `pm2 startup` is not supported, so after a reboot run `pm2 resurrect`.

## Expose with ngrok

```
ngrok config add-authtoken <YOUR_NGROK_AUTHTOKEN>
ngrok http --url=<your-domain>.ngrok-free.dev 3000
```

Keep that window open. The public endpoint is:

```
https://<your-domain>.ngrok-free.dev/mcp?token=<MCP_TOKEN>
```

## Connect a client

In Claude: Settings, Connectors, Add custom connector. Paste the endpoint URL
above, save, then enable the connector in a new chat.

To test locally with the MCP Inspector:

```
npx @modelcontextprotocol/inspector
```

Add a server with transport Streamable HTTP and URL
`http://localhost:3000/mcp?token=<MCP_TOKEN>`.

## Tools

| Tool | What it does |
|---|---|
| `list_files` | List files and folders in the workspace |
| `read_file` | Read a text file |
| `write_file` | Create or overwrite a file (logged) |
| `str_replace` | Replace one unique string in a file; fails if missing or ambiguous (logged) |
| `delete_file` | Delete a file (logged) |
| `search_files` | Case-insensitive text search across the workspace |
| `git_status` | Show git status of the workspace |
| `git_log` | Show recent commits of the workspace |
| `append_log` | Append a timestamped line to a log file (logged) |

## Security

- **Sandbox root:** every path is resolved against `workspace/`. Anything outside is rejected, including `../` paths, absolute paths, and symlink escapes.
- **Token auth:** `/mcp` requires `Authorization: Bearer <token>` or `?token=<token>`. Without it the server returns 401.
- **Audit log:** `write_file`, `str_replace`, `delete_file`, and `append_log` are recorded in `audit.log`, which is outside the workspace so agents can't edit it.
- **Secrets:** the token lives in `.env`, which is gitignored.
- **Known tradeoffs:** the token in the URL can leak into logs, the tunnel is public, there is no rate limiting, and `list_files` shows the `.git` folder.

## Handoff protocol

Agents keep shared memory in `workspace/` so a new session can resume:

- `PROJECT_STATE.md`: goal, what's done, what's next
- `PLAN_LOG.md`: planned steps
- `CHECKPOINTS.md`: what each session finished
- `DECISIONS.md`: choices and the reasons

See `evidence/` for the two-session demo transcript, screenshots, and copies of these files.

## Project layout

```
src/index.ts          server code
workspace/            agent sandbox (own git repo)
evidence/             transcript, screenshots, handoff copies
docs/report.md        short report
ecosystem.config.cjs  PM2 config
```