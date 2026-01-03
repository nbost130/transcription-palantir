# GitHub Issues Snapshot

**Refresh this snapshot** whenever you start a planning workflow or notice major GitHub issue churn.
Run:

```bash
python3 scripts/update_github_issues_snapshot.py
```

*Generated:* 2026-01-02T12:51:49Z

## Open Issues
| # | Title | Labels | Created | Notes |
| --- | --- | --- | --- | --- |
| 34 | Validate production directories and add env preflight | — | 2026-01-01 | ## Summary - add strict directory validation and expose configured paths in health endpoints - introduce scripts/check-env preflight and ... |
| 33 | Document production path pitfalls | — | 2026-01-01 | ### Summary Document the correct Linux production paths and common configuration pitfalls so operators stop pasting macOS defaults into `... |
| 32 | Add deploy-time .env sanity check | — | 2026-01-01 | ### Summary Prevent another macOS-path deployment by adding a CI/deploy preflight that compares the target host's `.env` against `.env.pr... |
| 31 | Add startup validation for production directories | — | 2026-01-01 | ### Summary\nFail the service fast when required directories are missing or look like the wrong OS paths so we don’t repeat the Dec 27 cr... |
| 30 | Expand API test coverage to prevent schema validation issues | — | 2026-01-01 | ## Overview Improve test coverage to catch schema validation mismatches before they reach production. ## Background A recent schema valid... |
| 23 | Fix vitest mock compatibility in transcription-worker.test.ts | bug | 2025-12-31 | ## Problem The `tests/workers/transcription-worker.test.ts` file uses mock syntax that was compatible with bun test but fails with vitest... |
| 21 | CI Failure: Bun setup failing with HTTP 400 error | — | 2025-12-29 | ## Problem CI builds failing during Bun setup with HTTP 400 error. ## Error Details **Run:** https://github.com/nbost130/transcription-pa... |
| 20 | CRITICAL: Projects endpoint has hardcoded limit=1000 causing data truncation | bug | 2025-12-29 | ## Bug Description Projects endpoint has hardcoded `limit=1000` parameter, causing silent data truncation when total project job count ex... |
| 19 | Bug: API /jobs endpoint returns empty array despite jobs existing in Redis | bug | 2025-12-29 | ## Summary The `/jobs` API endpoint was returning an empty array even though 103 jobs existed in Redis, preventing the dashboard from dis... |
| 17 | fix: Production deployment cleanup and port 9003 conflict resolution | — | 2025-12-28 | ## Summary Fixed improper production deployment workflow and resolved a critical port conflict preventing the transcription-palantir serv... |
| 11 | File watcher failed silently due to incorrect watch directory path | bug | 2025-12-27 | # File Watcher Configuration Issue - Prevention Measures ## Issue Summary The transcription service was configured to watch a macOS path ... |
| 10 | Dashboard shows stale job data due to API rate limiting (500 errors) | bug | 2025-12-27 | ## Summary Dashboard displayed stale transcription job data (showing "7 processing jobs") despite the actual count being 0. The issue per... |
| 9 | Progress reporting shows misleading 30% placeholder instead of actual transcription progress | bug, enhancement, ux, monitoring | 2025-12-26 | ## Issue Description The job progress field shows a hardcoded "30%" value when jobs are processing, but this is not actual transcription ... |

## Recently Closed Issues
| # | Title | Closed | Notes |
| --- | --- | --- | --- |
| 29 | fix: Schema validation causing 400 errors on retry and clean endpoints | 2026-01-01 | ## Problem Users encountered 400 errors when trying to retry failed jobs from the dashboard: ``` Failed to retry job: Object { message: "... |
| 28 | fix: Update Dockerfile to use correct whisper.cpp executable name | 2026-01-01 | The whisper.cpp project renamed the main executable from 'main' to 'whisper'. Updated Dockerfile to copy the correct executable name. Add... |
| 27 | Feat/epic 4 api contracts | 2026-01-01 | No description |
| 26 | Feat/epic 3 story 3 3 | 2026-01-01 | No description |
| 25 | Add Story 3.3: Remove delayed jobs and fix prioritized queue handling | 2026-01-01 | - Tracks work lost during origin/main merge - Removes artificial delays on job processing - Fixes BullMQ 5 prioritized queue visibility i... |
