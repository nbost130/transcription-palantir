---
task: "Palantir reliability overhaul: truthful errors, health, rate limit"
slug: 20260906-palantir-reliability-overhaul
effort: advanced
effort_source: auto
phase: complete
progress: 26/26
mode: iterate
started: 2026-09-06T15:05:00Z
updated: 2026-09-06T16:05:00Z
principal_stated_goal: "PAlantir on Mithrandir is broken. Please review and spin up Sonnet Agents to fix it as needed. We've had a lot of stability issues with this over the past year and I want it overhauled end to end if needed to make sure it works flawlessly"
principal_stated_goal_source: prompt
principal_stated_goal_signal: 2
principal_stated_goal_locked: 2026-09-06T15:05:00Z
context_sufficient: true
---

## Problem

`GET /api/v1/jobs` on Mithrandir returns HTTP 500 for roughly 7 of every 15 minutes, and has done so continuously since at least 2026-08-28 (every rotated log carries ~15k 500s). The process is not wedged: the same request returns 200 for the other 8 minutes. Verified root cause, from `src/api/server.ts:117-128` and the live log:

1. `@fastify/rate-limit` is configured `max: 100, timeWindow: 900000` (100 per 15 min) with **no allowList**, and the Mithrandir Unified API's reconciliation service (`/home/nbost/mithrandir-unified-api`, pid 3571350) polls `/api/v1/jobs` every 5 s from 127.0.0.1, i.e. 180 requests per window. 100 requests take ~8m20s; the remaining ~6m40s are rate-limited. Measured transitions: 500 at :01:25/:16:30/:31:25/:46:30, 200 at :08:10/:23:10/:38:10/:53:10.
2. The custom `errorResponseBuilder` returns a plain object with no `statusCode` and no `message`. The plugin hands that object to `setErrorHandler` as the error. `errorHandler` (`src/api/middleware/error.ts`) reads `error.message/stack/code/statusCode` (all `undefined`), logs `"error":{}`, and falls through to `error.statusCode || 500`. So every rate-limited request is a **500 with an empty error log** instead of a 429 with a reason. `/docs` and `/api/v1/health` are hit the same way (6 × 500 on `/api/v1/health` in the last 2 h), which also makes the deploy workflow's health probe flaky.
3. Nothing external could see it. Prometheus does not scrape :9003. Uptime Kuma checks tirith's `/api/tirith/health`, and tirith grades Palantir solely on `systemctl --user is-active`. The unified-api's own service check hits `/health` (unprefixed), which is a 404 and it accepts 4xx as a valid response.

Ruled out with evidence: Redis (PONG, 83,741 keys of which 82,733 are Performance Co-Pilot `pcp:*`; BullMQ owns 305), Whisper (never reached; failures are 0-1 ms), memory (67 MB RSS).

Secondary defects found on the same pass: `REMOVE_ON_COMPLETE`/`REMOVE_ON_FAIL` exist in `.env` but `src/config/index.ts` never reads them and `queue.ts` hardcodes `removeOnComplete: false, removeOnFail: false`; `COMPUTE_TYPE` defaults to `float16` in config on a GPU-less box; `src/services/queue.ts.bak`, `src/api/routes/services.ts.bak`, `src/api/routes/health.ts.backup` live in the compiled tree; `package.json` `lint` is a no-op echo.

## Vision

A request to Palantir either succeeds or fails with a status code and a logged reason that names the cause. The service's own readiness endpoint turns red when requests are failing, and something outside the process is watching that endpoint. A local caller can poll as fast as it likes. Running the smoke script on Mithrandir after deploy proves a real file went inbox → transcript → archive.

## Out of Scope

- Changing the Unified API's 5-second reconciliation poll (other repo; noted as follow-up).
- Authentication on :9003 (API_KEY is unused today; the service is tailnet/LAN-only). Separate decision.
- Moving pino output from `logs/service.log` to journald. Six `~/bin/mithrandir-*` scripts and logrotate read that file; the defect was log *content*, not location.
- Replacing BullMQ, Fastify, or faster-whisper. GPU work (Mithrandir has no NVIDIA GPU; CPU int8 is by design).
- Rewriting the docs sprawl (`MERGE_SUCCESS.md` etc.).

## Constraints

- **Never edit production directly.** Changes land via PR on `nbost130/transcription-palantir`, merged to `main`; the deploy workflow (or a manual `git reset --hard origin/main && npm install && npm run build && systemctl --user restart`) puts them on Mithrandir.
- **Surgical.** No component added or removed as a "fix". The rate limiter stays; it gets an allowList and a correct error shape.
- **Tests must run without Mithrandir.** Unit tests use the existing `tests/setup.ts` mocks; integration tests need a local Redis on :6379 (Homebrew redis, started 2026-09-06).
- **CPU int8 only** for Whisper (`CLAUDE.md`); any config default must agree.
- **Conventional Commits**, atomic, no `--no-verify`.
- `logs/service.log` remains the pino sink; its line shape (JSON, ISO `time`, `statusCode`) stays parseable by the existing scripts.

## Goal

After deploy, 200 consecutive `GET /api/v1/jobs` from Mithrandir's loopback within one minute all return 200; a rate-limited request from a non-allowlisted address returns 429 with a JSON body and a log line carrying `statusCode: 429` and a message; every 5xx logs a non-empty `err` with message and stack; `/api/v1/ready` returns 503 when Redis is unreachable or when the 5xx rate in the last 5 minutes exceeds threshold; an Uptime Kuma monitor watches `/api/v1/ready`; and `scripts/e2e-smoke.sh` passes on Mithrandir.

## Criteria

**Rate limiting (WP1)**
- [x] ISC-1: `GET /api/v1/jobs` ×200 from 127.0.0.1 inside 60 s → 200 every time. Probe: fastify `inject` loop in test; post-deploy `curl` loop on Mithrandir counting non-200.
- [x] ISC-2: A request from a non-allowlisted IP beyond `max` returns HTTP 429 with body `{success:false, error:"Rate limit exceeded", retryAfter, timestamp, requestId}` and header `retry-after`. Probe: inject with `remoteAddress: '203.0.113.9'`, `max: 2`.
- [x] ISC-3: The 429 above produces exactly one log line at `warn` with `statusCode: 429` and a non-empty `msg`/`err.message`; never `"error":{}`. Probe: pino test destination captures the line.
- [x] ISC-4: Loopback (`127.0.0.1`, `::1`, `::ffff:127.0.0.1`), RFC1918 and CGNAT `100.64.0.0/10` (tailnet) addresses are allowlisted; a public address is not. Probe: unit test on the exported `isTrustedAddress()` with 8 fixtures (4 allow, 4 deny).

**Error truthfulness (WP1)**
- [x] ISC-5: A handler that throws a non-Error value (plain object, string) yields HTTP 500 and a log line whose `err.message` names the thrown value (`String(value)` or JSON) and whose `err.type` is `"non-error"`. Probe: inject route that throws `{ foo: 1 }` and one that throws `"boom"`.
- [x] ISC-6: A thrown `Error` with `statusCode` 4xx keeps that status (404 stays 404, 400 stays 400, 429 stays 429); only genuine 5xx and status-less errors become 500. Probe: inject three routes.
- [x] ISC-7: Every 5xx log line carries `err.message`, `err.stack`, `requestId`, `method`, `url`, `statusCode`; 4xx lines log at `warn`, 5xx at `error`. Probe: captured log assertions in the same test file.
- [x] ISC-8: The "Request completed" access line for a failed request carries the same `statusCode` the client received. Probe: inject + captured log.

**Readiness that reflects failure (WP2)**
- [x] ISC-9: `GET /api/v1/ready` returns 503 with `status: "not ready"` and a `checks.redis` entry when the Redis connection is not `ready`. Probe: test with mocked `redisConnection.status = 'reconnecting'`.
- [x] ISC-10: `GET /api/v1/ready` performs a real queue read (`getJobCounts`) and returns 503 with `checks.queue.error` when it throws. Probe: mock `getJobCounts` to reject.
- [x] ISC-11: `src/services/request-stats.ts` exports `recordResponse(statusCode: number)` and `snapshot()`; after 10 responses of which 3 are 5xx inside the window, `snapshot().serverErrorRate` is `0.3`; entries older than the window are evicted. Probe: unit test with fake clock.
- [x] ISC-12: `/api/v1/ready` returns 503 with `checks.requests` when `serverErrorRate` over the last 5 min ≥ 0.5 with ≥ 10 samples; returns 200 with the rate reported when below. Probe: unit test seeding request-stats.
- [x] ISC-13: `/api/v1/ready` reports `checks.worker` (transcription worker running) and `checks.whisper` (python path executable) and neither check throws when the worker is not started. Probe: inject in test env.
- [x] ISC-14: `/api/v1/ready` responds in < 500 ms when Redis is up. Probe: `curl -w %{time_total}` on Mithrandir.

**Queue and config hygiene (WP3)**
- [x] ISC-15: `REMOVE_ON_COMPLETE` and `REMOVE_ON_FAIL` from env drive `defaultJobOptions.removeOnComplete/removeOnFail` (numeric keep-last-N; defaults 100 and 50). Probe: `tests/config.test.ts` + unit test reading `queueOptions`.
- [x] ISC-16: `COMPUTE_TYPE` defaults to `int8` in `src/config/index.ts`. Probe: grep + config test.
- [x] ISC-17: No `*.bak` / `*.backup` files under `src/`. Probe: `fd -e bak -e backup . src` → 0 results.
- [x] ISC-18: `bun run lint` runs Biome (`biome check ./src ./tests`) and exits 0 on the branch. Probe: run it.

**Operations (WP4 + deploy)**
- [x] ISC-19: `scripts/e2e-smoke.sh` gains an API section: 150 rapid loopback GETs all 200; `/api/v1/ready` 200 with `status: "ready"`; unknown job id → 404 JSON. Probe: read script; run on Mithrandir.
- [x] ISC-20: `.github/workflows/deploy.yml` verifies `/api/v1/ready` (not `/api/v1/health`) and fails on non-200. Probe: read file; deploy run log.
- [x] ISC-21: After deploy on Mithrandir: `git rev-parse HEAD` equals merged `origin/main`; `systemctl --user is-active` = active; `/api/v1/ready` = 200; 200-request loopback loop = 0 non-200; `e2e-smoke.sh` exit 0. Probe: SSH.
- [x] ISC-22: Uptime Kuma has an active keyword monitor on `http://100.77.230.53:9003/api/v1/ready` for `"status":"ready"`. Probe: `sqlite3 kuma.db` row + monitor shows up in Kuma.

**Anti-claims**
- [x] Anti-1: No request from any address ever receives a 500 whose cause is rate limiting. Probe: ISC-2/ISC-3.
- [x] Anti-2: No log line for a failed request contains `"error":{}` or `"err":{}`. Probe: grep captured logs in tests; grep `service.log` after 30 min on Mithrandir.
- [x] Anti-3: The rate limiter is not removed and public addresses are still limited. Probe: ISC-2.
**Lifecycle (found during verify; PR #44, #45)**
- [x] ISC-23: A singleton lock that EXPIRED (key gone, nobody holds it) is re-acquired by the heartbeat; the process keeps running. Probe: `DEL palantir:singleton-lock` on the live host → one "re-acquired" log line, same PID, `/ready` 200.
- [x] ISC-24: A lock held by ANOTHER instance makes the process exit non-zero and systemd restarts it to ready. Probe: `SET palantir:singleton-lock intruder PX 15000` → `ExecMainStatus=1`, `NRestarts` +1, `/ready` 200 within 90 s.
- [x] ISC-25: A shutdown whose `stop()` hangs still exits within 90 s. Probe: fake-timer unit test on `armShutdownDeadline` (live path not exercised; deadline did not need to fire in ISC-24).
- [x] ISC-26: `GET /api/v1/jobs/:jobId` returns the job's fields, never `data: {}`. Probe: real-Redis integration test create→lookup; live lookup by UUID returns 14 keys.
- [x] Anti-4: No file outside the owning work package's list is modified by that package's builder. Probe: `git diff --name-only` per branch.

## Test Strategy

| isc | type | check | threshold | tool |
|---|---|---|---|---|
| 1 | integration | inject loop | 200/200 | vitest + curl loop on Mithrandir |
| 2-8 | unit | fastify inject + pino capture | exact status/body/log fields | vitest |
| 9-13 | unit | inject with mocked services | exact status/body | vitest |
| 11 | unit | fake clock | rate 0.3, eviction | vitest |
| 14 | live | curl timing | < 0.5 s | curl -w |
| 15-16 | unit | config parse | exact values | vitest |
| 17 | static | fd | 0 files | fd |
| 18 | static | biome | exit 0 | bun run lint |
| 19-20 | static+live | read + run | exit 0 | bash on Mithrandir |
| 21 | live | SSH probes | all green | ssh |
| 22 | live | sqlite + UI | row present, active=1 | sqlite3 |

## Features

| name | description | satisfies | depends_on | parallelizable |
|---|---|---|---|---|
| WP1 api-errors | rate-limit allowList + correct 429 shape; errorHandler handles non-Error, keeps 4xx, logs `err` via pino serializer; access log statusCode; calls `recordResponse` | ISC-1..8, Anti-1..3 | interface of WP2 `request-stats` | yes |
| WP2 health-truth | `request-stats.ts` rolling window; deep `/api/v1/ready` (redis, queue read, error-rate, worker, whisper) | ISC-9..14 | none | yes |
| WP3 config-hygiene | wire REMOVE_ON_*; int8 default; delete .bak; real lint script | ISC-15..18 | none | yes |
| WP4 ops | smoke API section; deploy.yml readiness probe; docs (README health section, CLAUDE.md incident) | ISC-19..20 | none | yes |
| integrate+deploy | merge WPs to one branch, full suite with Redis, Opus adversarial review, PR, merge, deploy, live probes, Kuma monitor | ISC-21..22 | WP1..4 | no |

## Decisions

- 2026-09-06 15:05 — Diagnosis supersedes the handed-in one: not a wedge, not Redis, not retention. Rate limiter + broken error builder. A restart would have changed nothing.
- 2026-09-06 15:05 — Keep file logging (`logs/service.log`); fix content, not sink. Six operator scripts read the file.
- 2026-09-06 15:05 — Allowlist by address class (loopback/RFC1918/CGNAT) rather than raising `max`: the limiter's purpose is untrusted clients, and every real client is on the tailnet or loopback.
- 2026-09-06 15:05 — External watch = Uptime Kuma keyword monitor on `/api/v1/ready`. Tirith only grades systemd state and its manifest has no Palantir endpoint; adding one is a unified-api change and is deferred.
- 2026-09-06 15:05 — Builders: Sonnet, one worktree each, disjoint files; judge: Opus silent-failure review of the integrated diff. Cross-vendor audit skipped: single-tenant personal service, deterministic tests cover the changed surface (claim 11 visibility row).

- 2026-09-06 15:00 — vitest and `scripts/check-file-size.mjs` walked into `.claude/worktrees/**` from the main tree (4 agent worktrees → every test ran five times against one Redis, and the size gate flagged files it allowlists by path). Fixed with `vitest.config.ts` exclude and a `.claude` entry in the checker; not a product change.
- 2026-09-06 15:05 — `biome.json` said `test/**`; the directory is `tests/`. Biome had covered zero test files while `bun run lint` exited 0. Fixed path, applied its fixes; one unsafe fix (arrow-function mock used with `new`) broke a test and was reverted with a `biome-ignore`.
- 2026-09-06 15:08 — WP2 split checks into `src/api/routes/health-checks.ts` to stay under the 500-line pre-commit cap; `/ready` schema uses `additionalProperties: true` because fast-json-stringify strips undeclared fields (found by the builder when `checks` serialised as `{}`).
- 2026-09-06 15:10 — Health/readiness URLs excluded from request-stats (`isProbeUrl`): a 503 from `/ready` must not feed the error rate it reports.
- 2026-09-06 15:10 — The `src/*.bak` files named in Problem are untracked on the host, not in git; ISC-17 is satisfied by deleting them on Mithrandir at deploy, not by a commit.
- 2026-09-06 15:10 — Last two Actions deploys (2026-06-15, 06-22) failed at `is-active` five seconds after restart: `pkill` before `restart` raced `Restart=on-failure`. Removed the pkill; both gates now poll 30 s.
- 2026-09-06 15:25 — Opus adversarial review (silent-failure hunter) verdict SHIP-WITH-FIXES; dispositions: **adopted** (1) `trustProxy: false` — X-Forwarded-For let a public client claim 127.0.0.1 and pass the allowList, proven 4/4 at max 1; regression test added; (2) deploy readiness curl `|| echo 000` + `--max-time` — under `set -e` the first refused connection aborted the retry loop; (3) pino `error` serializer — 48 call sites still logged `{error}` as `{}`; (4) `jq has("uptime")`; (5) unfinished requests recorded as 499; (6) fs checks bounded and reasoned; (8) smoke burst `|| echo 000`; `.env.bak*` ignored. **Rebutted** (7) retention flip: the Unified API reconciler reads only the default first page and counts statuses (`reconciliation.service.ts:131-138`), no lookback. **Deferred** cosmetics: `retryAfter` body is the window not the wait (pre-existing shape), 4xx dilute the error rate, `samples.slice` O(n) at high rates.
- 2026-09-06 15:20 — CI lint failed on `src/workers/file-manager.ts`: `bun.lock` had Biome 2.4.15 (pre-commit) and `package-lock.json` 2.3.10 (CI) and they format differently. Pinned 2.4.15 exactly in both lockfiles.
- 2026-09-06 15:30 — Actions deploy fails at `tailscale: failed to evaluate SSH policy` for the `tag:ci` node (before any step runs on the host). Deployed manually over my own SSH per the Constraints clause. Follow-up: tailnet ACL for `tag:ci` → Mithrandir SSH.
- 2026-09-06 15:40 — Kuma's "Matrix via Ithildin" notification targeted `http://localhost:8080/uptime-kuma-webhook`: `localhost` is the container, and the route lives on Ithildin :3003, not the Unified API :8080. Repointed to `http://100.77.230.53:3003/uptime-kuma-webhook` (old value saved at `/tmp/kuma-notification-3.before.json` on the host). No Kuma alert had been deliverable before this.
- 2026-09-06 15:40 — Kuma → :9003 blocked by ufw from the docker bridge; Nathan ran `sudo ufw allow from 172.17.0.0/16 to any port 9003 proto tcp` (~15:44 UTC).
- 2026-09-06 15:50 — Follow-ups not done here: (a) Unified API reconciler polls `/jobs` every 5 s with no backoff; (b) the same file can get two jobs (API create = UUID, watcher = MD5 of path/size/mtime) when a caller POSTs a file that also lands in the inbox; (c) the OOM victim on 09-04 was a `bun` process at 20 GB RSS (pid 725820), owner unknown; (d) a Telegram bot token is stored in Kuma's (inactive) Telegram notification and surfaced in a tool output during inspection — rotate it; (e) `ci.yml` "Check formatting" runs `prettier --write` under npm (the `--check` is swallowed) — harmless, misleading.

## Changelog

- conjectured: the 500s were a wedge (BullMQ/Redis retention, unbounded keys) that a restart would clear. refuted by: the 500s recurred on a fixed 15-minute cycle while the same request returned 200 in between; every 500 completed in 0-1 ms; 98.8% of Redis keys belong to Performance Co-Pilot. learned: a rate limiter with no allowList plus an error builder that omits `statusCode` produces a 500 that looks like a wedge, and "restart it" would have taught nothing. criterion now: ISC-1..4, Anti-1.
- conjectured: with truthful errors and a deep readiness probe, the service could not again sit half-dead behind a green health check. refuted by: the rotated log — on 2026-09-04 the process lost its lock during an OOM stall, SIGTERM'd itself, hung on a Redis quit, and served HTTP for two days with the watcher stopped; readiness would have said 503 but nothing polled it and Kuma's alert channel pointed at its own container. learned: liveness needs three legs — a probe that reflects failure, something outside polling it, and a process that actually exits when it decides to. criterion now: ISC-22..25 plus the Kuma notification repoint.
- conjectured: Kuma could poll :9003 from its container like it polls :8080. refuted by: 8 s timeouts and zero requests in Palantir's log; ufw allowed 8080 but not 9003 from the docker bridge. learned: on Mithrandir, every new host port a container must reach needs its own ufw rule. criterion now: ISC-22 (Nathan added the rule 2026-09-06 ~15:44 UTC; first Kuma UP at 15:44:35).
- conjectured: a `data: { type: 'object' }` response schema is a harmless placeholder. refuted by: `GET /jobs/:id` serialising every job as `{}` (reported by a caller polling by UUID), the same mechanism WP2 hit on `/ready`. learned: in Fastify, an object schema with no properties and no `additionalProperties: true` is a field-stripper, not a placeholder. criterion now: ISC-26; class sweep fixed all five sites in `src/api/schemas/jobs.ts`.

## Verification

Evidence per claim (all 2026-09-06, Mithrandir unless noted):

- ISC-1, ISC-21: 200 sequential loopback `GET /api/v1/jobs?limit=1` → `total=200 non200=0`; `scripts/e2e-smoke.sh` → `ALL E2E SMOKE TESTS PASSED`, rc=0 (TEST 0 burst 150/150). Log since restart: `210 × 200, 1 × 302, 1 × 404`, zero 5xx.
- ISC-2..8: `src/api/error-handling.test.ts` (public address at max 2 → `[200,200,429,429]` with `retry-after`; XFF spoof → still 429; non-Error throw → 500 with `err.message`/`errorType`; 404/400 preserved; warn vs error levels). Suite: 25 files, 148 passed.
- ISC-4: `src/api/rate-limit-policy.test.ts`, 19 fixtures incl. `::ffff:127.0.0.1`, `100.64.0.0/10`, `fc00::/7`, `169.254/16` (deny).
- ISC-9..13: `src/api/routes/health.test.ts` (redis reconnecting → 503; `getJobCounts` reject/hang → 503 within timeout; 7/12 5xx → degraded 503; soft checks report without failing). Live: `/ready` 200 with redis/queue/requests/worker/whisper/file_watcher all `up`.
- ISC-14: `curl -w %{time_total}` on `/api/v1/ready` → 0.004 s.
- ISC-15..16: `tests/config.test.ts`, `src/services/queue-options.test.ts`; live: completed count trimmed from 296 to 100 after deploy (REMOVE_ON_COMPLETE honoured).
- ISC-17: `find src -name '*.bak' -o -name '*.backup' | wc -l` → 0 on the host (untracked files removed by hand).
- ISC-18: `bun run lint` → `Checked 60 files… No fixes applied`, rc=0, `biome.json` now includes `tests/**`.
- ISC-19..20: `scripts/e2e-smoke.sh` TEST 0 present and run; `.github/workflows/deploy.yml` gates on `/api/v1/ready` (workflow itself still fails earlier at Tailscale SSH policy for the CI tag — deploys were done manually; see Decisions).
- ISC-22: Kuma monitor id 24 "Palantir Readiness" active, keyword `"status":"ready"`; heartbeat `1|200 - OK, keyword is found|15:44:35`; Ithildin journal `Webhook: Palantir Readiness — DOWN` (11:40:11 EDT) and `— UP` (11:44:35 EDT).
- ISC-23..24: `/tmp/lifecycle-proof.py` output: `re-acquired lines: 1, pid same: True, ready: 200`; `old pid gone: True after 6 s; exit status: 1; recovered: True after 12 s; NRestarts: 1`.
- ISC-25: `src/utils/shutdown-deadline.test.ts` (2 cases).
- ISC-26: `tests/integration/api.test.ts` create→lookup; live `GET /api/v1/jobs/<uuid>` → 14 keys.
- Anti-2: `grep -c '"error":{}\|"err":{}'` on lines after the 15:30 restart → 0 (10,852 pre-restart lines remain in the same file for contrast).
- Anti-4: `git diff --name-only` per WP branch matched each owned list; WP2 added `health-checks.ts` (declared), WP3 touched `file-watcher.test.ts` (declared, caused by its own type change).


## Verification

(appended at verify)
