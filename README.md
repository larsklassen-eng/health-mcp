# health-mcp

An AI health-recovery assistant. Clinicians manage patients, review dashboards, and chat with an agent about one patient at a time. The agent answers by calling MCP tools that read that patient's health records.

> **Data policy:** this project is shared for learning purposes. Only synthetic or redacted data may be used. Real health data and API keys must never be committed. `data/`, `*.db` and `.env*` are git-ignored. Chat requests to the LLM only go to providers that keep no data (see [LLM data retention](#llm-data-retention)).

## Architecture

![System architecture](docs/architecture.png)

The editable source is [`docs/architecture.svg`](docs/architecture.svg).

### Components

| Workspace | Tech | Responsibility |
|---|---|---|
| `apps/web` | Next.js | **Patients**: list, create, import fake data. **Patient chat** (`/patients/:id/chat`): streams tokens and tool-call cards. **Dashboards**: an overview of all patients and a per-patient view. Talks only to `apps/api`. |
| `apps/api` | NestJS | REST endpoints for patients and dashboards. `POST /patients/:id/chat` streams the agent's reply over SSE. Runs the agent loop, calls the LLM through OpenRouter, and calls MCP tools. |
| `apps/mcp-server` | MCP TypeScript SDK | Standalone MCP server exposing patient-scoped health tools (labs, vitals, medications, symptoms, recovery milestones). |
| `packages/shared` | Zod | Schemas and inferred types shared by every app (API contracts, tool inputs). |
| `packages/db` | SQLite + Drizzle ORM | Database schema, migrations and client used by `apps/api` and `apps/mcp-server`. Stores patients, health records and chat history per patient. |
| `packages/evals` | Zod + TypeScript | Eval cases and results for the agent. Fixtures use synthetic patients only. |

### Chat flow (per patient)

1. The user opens a patient and sends a message in `apps/web`.
2. The web app calls `POST /patients/:id/chat` on `apps/api`.
3. The agent sends the patient's recent chat history, patient context and tool definitions to the LLM via OpenRouter (Anthropic Claude).
4. The LLM responds with a tool call.
5. The api's MCP client calls the tool on `apps/mcp-server`. **The api sets `patient_id` on every call, not the LLM,** so a chat can only ever read its own patient's data.
6. The tool queries SQLite and the result goes back to the LLM. Steps 3–6 repeat until the LLM has a final answer.
7. Tokens and tool events stream back to the UI over SSE, and the messages are saved to the patient's chat history.

### Key decisions

- **Monorepo:** Turborepo + Yarn 4 workspaces (`nodeLinker: node-modules`).
- **Frontend / backend:** Next.js + NestJS.
- **MCP server:** a separate app, connected over MCP Streamable HTTP.
- **Database:** SQLite for v1 (local file at `data/health.db`), accessed with Drizzle ORM + better-sqlite3. WAL mode so the api and MCP server can share the file.
- **LLM access:** OpenRouter Node.js SDK, default model Claude Opus 5.5 (`OPENROUTER_MODEL`). Requests are restricted to zero-data-retention providers that do not collect data.
- **Validation and evals:** Zod + TypeScript. No Python in the repo.

## Repository layout

```
apps/
  web/                Next.js frontend (patients pages)
  api/                NestJS backend
  mcp-server/         MCP server (patient-scoped tools over Streamable HTTP)
packages/
  shared/             Zod schemas + types (API, chat, MCP tools, import)
  db/                 SQLite schema, client and migrations (drizzle/)
  evals/              Eval case / result schemas
fixtures/
  synthetic-patients.json  8 invented patients in the import format
docs/
  architecture.png    Architecture diagram
  architecture.svg    Diagram source
```

## Status

`packages/shared` holds the Zod schemas for patients, health records, the JSON import format, chat and its SSE stream events, dashboards, MCP tool inputs and API routes. `packages/db` has the SQLite schema (7 tables: patients, lab results, vital signs, medications, symptoms, recovery milestones, chat messages), the first migration and a client. `packages/evals` is still a foundation. `apps/api` has its NestJS foundation: validated config, the database connection, `GET /health`, Zod request validation and a consistent error format. It also has the patient endpoints (create, list, get, update, delete, import) and each patient's chat history (read-only for now). Chat works end to end with tools: `POST /patients/:id/chat` runs the agent loop (OpenRouter model, tools on the MCP server), streams the answer and tool events, and saves the conversation with its tool calls. `GET /dashboards/overview` and `GET /dashboards/patients/:id` serve the dashboards (how each number is calculated is documented on the schemas in `packages/shared/src/schemas/dashboard.ts`). `apps/web` has the Patients pages: list, create, import a JSON file of fake data, a profile with an edit page (including delete, after a confirmation), and a chat per patient that streams the answer as it is written, with a card for each tool call (what was asked, and the result when expanded). It also has the dashboards: an overview of all patients (`/dashboard`) and one per patient (`/patients/:id/dashboard`). `apps/mcp-server` serves the five read-only tools (`get_patient_profile`, `get_lab_results`, `get_vitals_trend`, `get_medications`, `get_recovery_milestones`) over MCP Streamable HTTP, on localhost only and behind a shared token; `log_symptom`, the only tool that writes, comes next. Every workspace has tests, and CI runs on each push to `main`. `fixtures/synthetic-patients.json` has 8 invented patients to import (see [fixtures/README.md](fixtures/README.md)). Work is tracked in Linear (LKLA-1).

## Getting started

Requirements: Node.js 24+ (CI uses the version in `.nvmrc`) and any `yarn` command on your PATH (`npm i -g yarn`). The repo pins Yarn 4.18.1 in `.yarn/releases`, so whichever `yarn` you have will run that version.

```sh
yarn install
yarn build       # build all packages
yarn typecheck   # type-check all packages, including tests
yarn test        # run all tests
yarn format      # format code with Prettier (yarn format:check only checks)
yarn db:migrate  # create data/health.db (if needed) and apply migrations
yarn dev         # watch-build packages, run apps/api on :3001, apps/mcp-server on :3002 and apps/web on http://localhost:3000
```

Copy `.env.example` to `.env` to change settings; the defaults work without it. To give the chat its tools, set `MCP_AUTH_TOKEN` in `.env` (`openssl rand -hex 32`); apps/api and apps/mcp-server both read it. Without it the MCP server rejects every request and chat answers without tools.

### Database

The schema lives in `packages/db/src/schema.ts`; its enum values come from the Zod schemas in `packages/shared`. Migrations are SQL files in `packages/db/drizzle/` and are committed.

After changing the schema:

```sh
yarn db:generate --name <short_description>   # write a new SQL migration
yarn db:migrate                               # apply it to data/health.db
```

Store timestamps as UTC ISO strings ending in `Z` (convert offsets before writing), so sorting by text matches sorting by time.

Each package compiles to `dist/`. Apps import packages as `@health-mcp/<name>`.

### Testing

Tests use [Vitest](https://vitest.dev) and live in each workspace's `test/` folder. `yarn test` runs them all through Turborepo; to run one workspace, use e.g. `yarn workspace @health-mcp/db test`.

- **Database tests** use a fresh in-memory SQLite database with all migrations applied (`createTestDb()` in `packages/db/test/helpers.ts`).
- **API tests** boot the real Nest app on a random port with the same setup as `main.ts` (`startTestApp()` in `apps/api/test/helpers.ts`) and call it with `fetch`. They always use an in-memory database, never `data/health.db`.
- **LLM tests** never call OpenRouter: `OpenRouterLlmClient` is tested against a local fake server speaking OpenRouter's streaming format, and the rest of the api uses `FakeLlmClient` (`apps/api/test/fakes/`), which replays scripted model turns. The test config also blanks `OPENROUTER_API_KEY`.
- **Agent tests** (`apps/api/test/chat-agent.e2e.test.ts`) run the chat endpoint with `FakeLlmClient` and `FakeMcpClient`. `HttpMcpClient` itself is tested against a real MCP SDK server over HTTP; the test config blanks `MCP_AUTH_TOKEN`, so tests never reach a running MCP server.
- **MCP server tests** (`apps/mcp-server/test/`) run the real server on a random loopback port with an in-memory database and call it with the MCP SDK's client, the same way the api will (`startTestServer()` in `apps/mcp-server/test/helpers.ts`).
- **Web tests** (`apps/web/test/`) run in happy-dom with Testing Library. Server actions and pages are tested with the api client and Next's `redirect`/`notFound` mocked; forms receive their action as a prop so tests can pass a fake one.
- API tests are compiled with SWC (`apps/api/vitest.config.ts`) because Vite's default transformer cannot compile NestJS parameter decorators such as `@Body()`.
- Test files are type-checked by `yarn typecheck` (via each workspace's `tsconfig.test.json`); Vitest itself does not check types.

### Formatting

[Prettier](https://prettier.io) formats TypeScript, JavaScript, JSON, CSS and YAML with a line width of 100 (`.prettierrc.json`). Generated files, the synthetic fixture and Markdown are skipped (`.prettierignore`). Run `yarn format` before committing; CI fails if a file is not formatted. Prettier does not wrap comments or string literals, so keep those short by hand.

### Continuous integration

`.github/workflows/ci.yml` runs on every push to `main` (and manually from the Actions tab): install with a locked `yarn.lock`, check formatting, build, type-check, test. There are no pull requests in this repo, so a red run means `main` is broken.

### Environment variables

| Variable | Used by | Default |
|---|---|---|
| `DATABASE_PATH` | `packages/db`, `apps/api`, `apps/mcp-server` | `data/health.db` |
| `PORT` | `apps/api` | `3001` |
| `API_URL` | `apps/web` (server side only) | `http://localhost:3001` |
| `WEB_ORIGIN` | `apps/api` (CORS) | `http://localhost:3000` |
| `OPENROUTER_API_KEY` | `apps/api` (chat) | none; the api starts without it, chat requests fail. Keep it in `.env`, never commit it |
| `OPENROUTER_MODEL` | `apps/api` (chat) | `anthropic/claude-opus-5.5` |
| `OPENROUTER_ZDR` | `apps/api` (chat) | `true`; only use zero-data-retention providers. Set `false` for a model that has none (data-collecting providers stay excluded) |
| `MCP_AUTH_TOKEN` | `apps/mcp-server`, `apps/api` | none; the MCP server rejects every request and chat answers without tools. Generate with `openssl rand -hex 32`, keep it in `.env`, never commit it |
| `MCP_HOST` | `apps/mcp-server` | `127.0.0.1`; only loopback addresses (`127.0.0.1`, `localhost`, `::1`) are allowed |
| `MCP_PORT` | `apps/mcp-server` | `3002` |
| `MCP_URL` | `apps/api` | `http://127.0.0.1:3002/mcp` |
| `LLM_MAX_TOKENS` | `apps/api` (chat) | `16000`; output cap per model turn. OpenRouter reserves credit for this amount on every request, so lower it if requests fail with 402 |
| `CHAT_HISTORY_MAX_CHARS` | `apps/api` (chat) | `40000` (about 10k tokens); characters of earlier messages sent with each question. The newest whole messages that fit are kept, starting with a question; when older ones are left out, the system prompt tells the model |

### LLM data retention

Patient context and chat history are sent to the LLM, so every OpenRouter request carries a provider policy (`apps/api/src/llm/openrouter-llm-client.ts`):

- `data_collection: "deny"` (always): never route to a provider that stores prompts or uses them for training.
- `zdr: true` (default, `OPENROUTER_ZDR`): only route to [zero-data-retention](https://openrouter.ai/docs/features/zdr) endpoints. For the default Claude models these are Amazon Bedrock and Google Vertex; Anthropic's own endpoint is skipped.

If a model has no ZDR provider, OpenRouter rejects the request with a 404 and the error message points to `OPENROUTER_ZDR`. Check a model's ZDR endpoints with `curl -s https://openrouter.ai/api/v1/endpoints/zdr` before switching `OPENROUTER_MODEL`. This is in addition to, not instead of, the rule that only synthetic data is used.

### MCP server (`apps/mcp-server`)

Serves the patient-scoped health tools over [MCP](https://modelcontextprotocol.io) Streamable HTTP at `POST http://127.0.0.1:3002/mcp`. It is stateless: each request gets a fresh server, no sessions are kept, and `GET`/`DELETE /mcp` return 405. `GET /health` needs no token.

| Tool | Status |
|---|---|
| `get_patient_profile` | Done: demographics, diagnosis and surgery date |
| `get_lab_results` | Done: newest first, as `{ results, hasMore }`. Optional `test_name` (case-insensitive; when nothing matches, `availableTests` lists the patient's test names), `since` (any UTC offset) and `limit` (default 20, max 100) |
| `get_vitals_trend` | Done: one `vital_type` over the last `days` (default 30, max 365), oldest first, with a `summary` (count, min, max, average, first, latest, change). Above 120 readings it returns one `daily` entry per UTC day instead of every reading. When the window is empty, `lastRecordedAt` says when the vital was last recorded |
| `get_medications` | Done: `status` is `active` (default), `stopped` or `all`. Active before stopped, then the most recently started first, as `{ medications }` |
| `get_recovery_milestones` | Done: optional `status` (`pending`, `achieved`, `missed`). By target date, earliest first, undated last, as `{ milestones, counts }`; `counts` has every status, whatever the filter |
| `log_symptom` | Not yet |

Tool descriptions and input schemas come from `MCP_TOOLS` in `packages/shared`; each tool's input is the model's arguments plus `patient_id`, validated before the tool runs. Results are JSON text. An unknown patient or invalid input is returned as a tool error (`isError`) that the model can read; unexpected failures return a generic message and are logged.

The tools trust the `patient_id` they receive, so the server must only be reachable by apps/api:

- **Localhost only:** it listens on `127.0.0.1` and refuses non-loopback `MCP_HOST` values.
- **Shared token:** every `/mcp` request needs `Authorization: Bearer $MCP_AUTH_TOKEN`, checked before the body is read. Without a configured token the server rejects everything (fail closed).
- **DNS rebinding protection:** requests whose `Host` header is not `localhost`, `127.0.0.1` or `[::1]` get 403, so a web page cannot reach the server through the browser.

### Web app (`apps/web`)

| Page | What it does |
|---|---|
| `/patients` | List of patients (name, MRN, diagnosis, status), with links to create or import |
| `/patients/new` | Create form; validated with the shared Zod schema, a duplicate MRN shows on the MRN field |
| `/patients/import` | Upload a JSON file of synthetic patients (format shown on the page); problems are listed with their path, e.g. `patients.0.labResults.2.flag` |
| `/dashboard` | Overview of all patients: totals, abnormal labs in the last 7 days, and per patient the last activity, abnormal labs, active medications, latest pain score and milestone progress |
| `/patients/:id` | Profile, with links to edit it, the patient's dashboard and chat |
| `/patients/:id/edit` | Edit form (the create form, filled in; emptying an optional field clears it), and a Delete button that asks for confirmation first, because it also deletes the patient's records and chat history |
| `/patients/:id/dashboard` | One patient: latest vitals with a sparkline trend, the latest result of each lab (abnormal ones highlighted), active medications, recent symptoms and recovery milestones |
| `/patients/:id/chat` | The patient's chat: history, a message box (Enter sends, Shift+Enter adds a line) and the answer streamed as it is written, with a Stop button. Answers are rendered as Markdown (bold, italics, lists, tables, code) with `react-markdown`; raw HTML is not rendered, images are never loaded (a model-written image URL could leak data), and links open in a new tab. Above each answer, a collapsible card per tool call shows the tool, its arguments, running/done/failed, and the result (first 4000 characters) |

The web app only calls the api from the server (server components and server actions in `src/app/patients/actions.ts`, through `src/lib/api-client.ts`), so `API_URL` never reaches the browser. If the api is not running, the pages say so instead of failing.

Chat answers stream through a proxy route, `POST /patients/:id/chat/stream` (`src/app/patients/[id]/chat/stream/route.ts`). It validates the message, forwards it to the api and passes the server-sent events back unchanged. Closing the page or pressing Stop aborts the api request, which stops the model. A stopped or failed answer is not saved, but the question is.

### API endpoints (`apps/api`)

| Method | Path | Body | Response |
|---|---|---|---|
| `GET` | `/health` | | `HealthCheckResponse` |
| `GET` | `/patients` | | `PatientListResponse` (summaries, sorted by last name) |
| `POST` | `/patients` | `CreatePatientInput` | `201` `Patient` |
| `POST` | `/patients/import` | `PatientImportFile` (up to 5 MB) | `201` `PatientImportResult` |
| `GET` | `/patients/:id` | | `Patient` |
| `PATCH` | `/patients/:id` | `UpdatePatientInput` (only the fields to change; `null` clears `surgeryDate` or `notes`) | `Patient` |
| `DELETE` | `/patients/:id` | | `204`; also deletes the patient's records and chat history |
| `GET` | `/patients/:id/chat` | | `ChatHistoryResponse` (the patient's messages, oldest first) |
| `POST` | `/patients/:id/chat` | `SendChatMessageRequest` | `200` SSE stream of `ChatStreamEvent` (see below) |
| `GET` | `/dashboards/overview` | | `DashboardOverview` |
| `GET` | `/dashboards/patients/:id` | | `PatientDashboard` |

Types are the Zod schemas in `@health-mcp/shared`. Errors: `400` invalid input, `404` unknown patient, `409` duplicate MRN.

**Import file format** (`PatientImportFile`): `{ "version": 1, "patients": [ { "patient": {...}, "labResults": [], "vitals": [], "medications": [], "symptoms": [], "milestones": [] } ] }`. Record lists are optional. Timestamps may carry any UTC offset and are stored in UTC. The import is all-or-nothing: if any patient fails (invalid data, duplicate MRN), nothing is saved.

### Chat streaming

`POST /patients/:id/chat` with `{ "message": "..." }` answers with server-sent events, one JSON `ChatStreamEvent` per `data:` line:

```
data: {"type":"message_start","messageId":"…"}
data: {"type":"tool_call_start","toolCallId":"call_1","name":"get_patient_profile","input":{}}
data: {"type":"tool_call_result","toolCallId":"call_1","output":{"surgeryDate":"2026-09-01",…},"isError":false}
data: {"type":"text_delta","delta":"Surgery was on "}
data: {"type":"text_delta","delta":"2026-09-01."}
data: {"type":"message_end","messageId":"…","stopReason":"stop"}
```

- Invalid input (`400`) and unknown patients (`404`) are normal JSON errors, returned before the stream starts.
- The question is saved first; the answer is saved under `messageId` only when it completes.
- If the model fails, the stream ends with `{"type":"error","message":"…"}` (details are logged on the server, not sent) and no partial answer is saved.
- If the client disconnects, the model request is cancelled and nothing more is saved.
- The model gets a system prompt with the patient's profile (`apps/api/src/chat/system-prompt.ts`), then the text of the patient's recent chat history: the newest whole messages within `CHAT_HISTORY_MAX_CHARS` (40,000 characters by default), starting with a question. When older messages are left out, the system prompt says so. The saved history keeps every message. Tool results from earlier answers are not resent; the model calls the tools again when it needs the data.

#### Agent loop (`apps/api/src/chat/agent.service.ts`)

1. The api asks the MCP server which tools it offers and gives the model those that are also in `MCP_TOOLS` (shared descriptions; JSON Schema of the model's arguments, without `patient_id`). If the MCP server is down or `MCP_AUTH_TOKEN` is not set, the model gets no tools and answers from the profile.
2. When the model asks for tools, each call is checked: the tool must have been offered, and the arguments must pass the shared Zod schema (defaults applied, unknown keys such as a model-chosen `patient_id` dropped). Problems go back to the model as tool errors instead of failing the answer.
3. `HttpMcpClient` calls the tool with the chat's `patient_id`, added after the model's arguments so nothing can override it.
4. Results go back to the model, and the loop repeats until it answers, at most 8 rounds of tool calls (`MAX_TOOL_ROUNDS`); a model still asking for tools after that is stopped with `stopReason: "max_tool_rounds"`.
5. Each call is streamed as `tool_call_start` (the validated arguments the tool received) and `tool_call_result`, and saved with the answer in `toolCalls`. Logs record tool names and timings, never arguments or results.

To try it with a real key (uses OpenRouter credits), set `OPENROUTER_API_KEY` in `.env`, run `yarn dev`, create a patient, then:

```sh
curl -N -X POST http://localhost:3001/patients/<id>/chat \
  -H 'Content-Type: application/json' -d '{"message":"Summarize this patient."}'
```

### API conventions (`apps/api`)

- Validate request input by passing a Zod schema from `@health-mcp/shared` to the parameter decorator, e.g. `@Body({ schema: CreatePatientInputSchema })`. Invalid input returns 400 with the issues in `details`.
- Every error response has the shared `ApiError` shape: `{ statusCode, error, message, details? }`. Unexpected errors return a generic 500 and are logged.
- Use paths from `API_ROUTES` in `@health-mcp/shared` so the web app and api agree on URLs.
- Inject `DatabaseService` and use `.db` for Drizzle queries; inject config with `@Inject(ENV)`.
