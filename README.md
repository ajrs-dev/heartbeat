# Heartbeat

Uptime and latency monitoring. Add a URL and Heartbeat checks it on a schedule, tracks uptime and response times, opens an incident when it goes down, pushes results to open dashboards in real time, and can publish a public status page.

Built as a full-stack TypeScript project: **React + Vite** front end, **Express + SQLite** back end, deployed as a single Node process.

[![CI](https://github.com/ajrs-dev/heartbeat/actions/workflows/ci.yml/badge.svg)](https://github.com/ajrs-dev/heartbeat/actions/workflows/ci.yml)

## Features

- **Scheduled checks** with per-monitor interval (30 s to 1 h) and timeout, bounded concurrency, and no duplicate in-flight checks.
- **Live dashboard** over server-sent events: new results appear without a refresh.
- **Uptime and latency stats** for 24 h / 7 d / 30 d (uptime %, average and p95 latency) and a 48-slot health strip per monitor.
- **Incidents** open after two consecutive failures (back-dated to the first) and close on recovery, so one dropped request doesn't raise an alarm.
- **Public status page** per account at `/status/:slug`, showing only names and health for monitors you mark public.
- **Accounts**: registration, login, logout, per-user data isolation.

## Quick start

Requires Node 22.13 or newer (it uses the built-in `node:sqlite`, so there is nothing native to compile).

```bash
npm install
npm run build       # builds the UI so the server can serve it
npm run demo
```

Then open http://localhost:3001. The demo account's credentials are printed in the terminal. The demo starts a local target server with deliberately flaky endpoints, seeds 36 hours of **generated** history so the charts are populated, and then runs real checks against the local targets. The public page is at `/status/demo`.

With Docker (a multi-stage image: production dependencies only, runs as the unprivileged `node` user, data on a volume):

```bash
docker compose up --build
# or: docker build -t heartbeat . && docker run -p 3001:3001 -v heartbeat-data:/data heartbeat
```

The container starts with a fresh, empty database: create an account in the UI, then add monitors.

In production mode session cookies are marked `Secure`, so the app must be served over HTTPS (browsers treat `http://localhost` as secure, so local use works). Put it behind a TLS-terminating reverse proxy or platform load balancer, and set `TRUST_PROXY=1`.

Development with hot reload (API on :3001, UI on :5173):

```bash
npm run dev
```

Production:

```bash
npm run build
NODE_ENV=production PORT=3001 DB_PATH=./data/heartbeat.db npm start
```

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3001` | HTTP port |
| `DB_PATH` | `./data/heartbeat.db` | SQLite file |
| `NODE_ENV` | | `production` marks session cookies `Secure` |
| `TRUST_PROXY` | `0` | Number of reverse proxies in front (so rate limiting sees real client IPs) |
| `ALLOW_PRIVATE_TARGETS` | `false` | Allow monitors to target private/loopback addresses (development only) |
| `RETENTION_DAYS` | `30` | How long raw checks are kept |
| `MIN_INTERVAL_SEC` | `30` | Shortest allowed check interval |

## Architecture

```
React SPA ──HTTP/JSON──▶ Express API ──▶ SQLite (WAL)
    ▲                        │  ▲
    └───── SSE stream ◀──────┘  │
                                │
                     Scheduler (1 s tick) ──▶ checker ──▶ target URLs
```

- **`server/src/scheduler.ts`**: a one-second tick asks the database which monitors are due and runs them with bounded concurrency. The database is the source of truth, so pausing, editing or deleting a monitor never needs to touch scheduler state, and the schedule survives restarts.
- **`server/src/checker.ts`**: performs one check with Node's `http`/`https`, using a fresh connection each time so latency reflects a real connection. It does not follow redirects.
- **`server/src/checks.ts`**: stores results, keeps a monitor's "last" fields in sync, and maintains incidents inside one transaction.
- **`server/src/stats.ts`**: uptime, average, nearest-rank p95, and time bucketing (done in SQL).
- **`server/src/events.ts` + `routes/events.ts`**: an in-process pub/sub hub feeding one SSE response per open dashboard.
- **`web/`**: React Router pages, a typed API client, dependency-free SVG charts.

### Security decisions

- **SSRF protection.** Users choose the URLs the server requests, which is a classic server-side request forgery risk (cloud metadata at `169.254.169.254`, internal admin services). Defence is layered: URLs are validated on create and update; the resolved address is re-checked at connect time through a custom DNS `lookup`, which closes the DNS-rebinding gap that checking only the hostname leaves open; IPv4-mapped IPv6 forms (`::ffff:7f00:1`) are normalised before checking; and redirects are never followed. Covered in `server/test/ssrf.test.ts` and `checker.test.ts`.
- **Passwords** are hashed with scrypt (N=2^15, r=8, p=1) and a per-hash salt. Login does the same work for unknown emails so response time doesn't reveal which addresses have accounts.
- **Sessions** are random 256-bit tokens in an `HttpOnly`, `SameSite=Lax` cookie (`Secure` in production). Only a SHA-256 of the token is stored, and logout deletes it server-side, so a replayed cookie stops working.
- **Authorisation.** Every monitor query is scoped to the signed-in user; another user's monitor returns 404, indistinguishable from a missing one.
- **Request hardening.** Zod validates every input; JSON bodies are capped at 10 KB; auth endpoints are rate limited; state-changing requests with a foreign `Origin` are rejected; security headers (CSP, `X-Frame-Options`, `nosniff`) are set.
- The public status page returns monitor names and health only, never URLs or error text.

### Trade-offs and what I would change at scale

- **Single process, in-memory rate limiter and event hub.** Right for one instance. Several instances would need a shared store (e.g. Redis) for rate limiting and pub/sub for live events, plus a leader or lease so each check runs once.
- **SQLite.** Fast and zero-ops for this workload, with one writer. A higher write volume would move checks to Postgres (ideally a time-series table with partitioning); the access patterns (`monitor_id, checked_at` range scans) are already index-friendly.
- **Percentiles are computed in application code** from the sorted latencies of one window (about 2,900 rows at the shortest interval over 24 h). Pre-aggregated rollups would be the next step for long windows.
- **Checks measure time to response headers**, not full download time, and treat 2xx/3xx as up. Custom expected status codes and body assertions are natural extensions.
- **Test coverage gaps:** the React tests run in jsdom against a stubbed API and a fake `EventSource`, so there are no real-browser end-to-end tests (Playwright would be the next addition). The Docker image was built and smoke-tested locally (Docker 29, Linux containers: health check, UI and SPA routing, SSRF refusal, real outbound checks, data and sessions surviving a restart) and CI repeats the core of that on every push.

## Project layout

```
server/
  src/        app.ts, scheduler.ts, checker.ts, ssrf.ts, checks.ts, stats.ts, auth.ts, routes/, demo.ts
  test/       107 tests: SSRF rules, connect-time hostname resolution (incl. DNS rebinding), auth, ownership isolation,
              stats maths, incidents, checker, scheduler, SSE streaming, static serving
web/
  src/        pages/, components/, hooks/, lib/format.ts; 58 tests (Testing Library): pages, dialog, charts, live updates
```

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | API and UI with hot reload |
| `npm run build` | Typecheck and build the UI, compile the server |
| `npm start` | Run the compiled server (serves the built UI) |
| `npm test` | Server and web tests (Vitest, Supertest) |
| `npm run typecheck` | `tsc --noEmit` for both packages |
| `npm run demo` | Seeded demo with a flaky local target |

## API

All routes are under `/api`; authenticated routes use the session cookie.

| Method | Path | Description |
| --- | --- | --- |
| `POST` | `/auth/register`, `/auth/login`, `/auth/logout` | Account and session |
| `GET` | `/auth/me` | Current user |
| `GET` | `/monitors/overview` | All monitors with 24 h stats and a 48-slot timeline |
| `GET`/`POST` | `/monitors` | List or create |
| `GET`/`PATCH`/`DELETE` | `/monitors/:id` | Read, update (including pause) or delete |
| `GET` | `/monitors/:id/stats` | 24 h / 7 d / 30 d uptime and latency |
| `GET` | `/monitors/:id/buckets?hours=&count=` | Time-bucketed health for charts |
| `GET` | `/monitors/:id/checks?limit=` | Most recent raw checks |
| `GET` | `/monitors/:id/incidents` | Incident history |
| `GET` | `/events` | Server-sent events stream of check results |
| `GET` | `/public/:slug` | Public status page data |
| `GET` | `/health` | Liveness probe |
