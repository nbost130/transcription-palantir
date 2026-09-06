#!/usr/bin/env bash
# 🔮 Transcription Palantir — End-to-End Smoke Test
#
# Phase 3 deliverable: a script that exercises the full pipeline against
# a RUNNING palantir service. Drops three test files, polls for outputs,
# verifies the state transitions, then reports PASS/FAIL.
#
# Tests:
#   1. Fresh audio → staged → transcribed → archived → work cleaned
#   2. Duplicate content (different filename) → quarantined, no transcribe
#   3. Two unique files in same subdir → both transcripts survive (Phase 2.5)
#   4. /api/v1/dedup-stats reports the expected counter deltas
#   5. /api/v1/metrics (Prometheus) exposes the new Phase 3 counters
#
# Usage:
#   ./scripts/e2e-smoke.sh                   # against http://localhost:9003
#   API_URL=http://other:9003 ./scripts/e2e-smoke.sh
#
# Exit code 0 on PASS, 1 on FAIL. Designed to be CI-friendly.

set -euo pipefail

API_URL="${API_URL:-http://localhost:9003}"
INBOX="${INBOX:-/mnt/data/whisper-batch/inbox/single-files-$(date +%Y%m%d)}"
TRANSCRIPTS="${TRANSCRIPTS:-/mnt/data/whisper-batch/completed/transcripts/single-files-$(date +%Y%m%d)}"
ARCHIVE="${ARCHIVE:-/mnt/data/palantir/archive/$(date +%Y-%m)}"
DUPLICATES="${DUPLICATES:-/mnt/data/palantir/duplicates}"
TMP="${TMP:-/tmp/palantir-smoke-$$}"

mkdir -p "$INBOX" "$TMP"

# Snapshot starting metrics so we compute deltas.
START_STATS=$(curl -fsS "$API_URL/api/v1/dedup-stats" || echo '{}')
read -r START_STAGED START_ARCHIVED START_DEDUP < <(echo "$START_STATS" \
  | python3 -c "import sys,json; d=json.load(sys.stdin).get('counters',{}); print(d.get('jobsStaged',0), d.get('jobsArchived',0), d.get('dedupSaved',0))")

pass() { echo "  ✓ $*"; }
fail() { echo "  ✗ $*"; FAILED=1; }

cleanup() {
  rm -rf "$TMP" 2>/dev/null || true
  rm -f "$INBOX"/smoke-*.ogg 2>/dev/null || true
}
trap cleanup EXIT

FAILED=0

echo "═══ Health check ═══"
WAITED=0
while [ $WAITED -lt 30 ]; do
  READINESS=$(curl -fsS "$API_URL/api/v1/ready" 2>/dev/null || echo '{}')
  if [ "$(echo "$READINESS" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("status",""))' 2>/dev/null)" = "ready" ]; then
    pass "service ready (after ${WAITED}s)"
    break
  fi
  sleep 2 && WAITED=$((WAITED + 2))
done
if [ "$WAITED" -ge 30 ]; then
  fail "service did not become ready within 30s"
fi

echo ""
echo "═══ TEST 0 — API contract ═══"
SEED0=$(date +%s%N)

# /api/v1/ready → HTTP 200, JSON .status == "ready"
READY_CODE=$(curl -s -o "$TMP/ready-body.json" -w '%{http_code}' "$API_URL/api/v1/ready" 2>/dev/null || echo "000")
READY_STATUS=$(python3 -c '
import json
try:
    print(json.load(open("'"$TMP"'/ready-body.json")).get("status", ""))
except Exception:
    print("")
' 2>/dev/null)
if [ "$READY_CODE" = "200" ] && [ "$READY_STATUS" = "ready" ]; then
  pass "/api/v1/ready → 200, status=ready"
else
  fail "/api/v1/ready → HTTP $READY_CODE, status=$READY_STATUS (expected 200/ready)"
fi

# Burst: 150 sequential loopback GETs — must all be 200 (rate limiter must not
# 500 a local caller; ISC-1/Anti-1 from the reliability-overhaul ISA)
BURST_LOG="$TMP/burst-codes.txt"
: > "$BURST_LOG"
for _ in $(seq 1 150); do
  curl -s -o /dev/null -w '%{http_code}\n' "$API_URL/api/v1/jobs?limit=1" >> "$BURST_LOG"
done
NON200_COUNT=$(grep -vc '^200$' "$BURST_LOG" || true)
if [ "$NON200_COUNT" -eq 0 ]; then
  pass "150/150 loopback GET /api/v1/jobs?limit=1 returned 200 (non-200 count: $NON200_COUNT)"
else
  fail "$NON200_COUNT of 150 loopback GET /api/v1/jobs?limit=1 did NOT return 200"
fi

# Unknown job id → HTTP 404, JSON .success == false
NOTFOUND_CODE=$(curl -s -o "$TMP/notfound-body.json" -w '%{http_code}' "$API_URL/api/v1/jobs/does-not-exist-$SEED0" 2>/dev/null || echo "000")
NOTFOUND_SUCCESS=$(python3 -c '
import json
try:
    d = json.load(open("'"$TMP"'/notfound-body.json"))
    print("false" if d.get("success") is False else "not-false")
except Exception:
    print("parse-error")
' 2>/dev/null)
if [ "$NOTFOUND_CODE" = "404" ] && [ "$NOTFOUND_SUCCESS" = "false" ]; then
  pass "GET /api/v1/jobs/does-not-exist-$SEED0 → 404, success=false"
else
  fail "GET /api/v1/jobs/does-not-exist-$SEED0 → HTTP $NOTFOUND_CODE, success=$NOTFOUND_SUCCESS (expected 404/false)"
fi

# /api/v1/health → HTTP 200, JSON .status == "ok"
HEALTH_CODE=$(curl -s -o "$TMP/health-body.json" -w '%{http_code}' "$API_URL/api/v1/health" 2>/dev/null || echo "000")
HEALTH_STATUS=$(python3 -c '
import json
try:
    print(json.load(open("'"$TMP"'/health-body.json")).get("status", ""))
except Exception:
    print("")
' 2>/dev/null)
if [ "$HEALTH_CODE" = "200" ] && [ "$HEALTH_STATUS" = "ok" ]; then
  pass "/api/v1/health → 200, status=ok"
else
  fail "/api/v1/health → HTTP $HEALTH_CODE, status=$HEALTH_STATUS (expected 200/ok)"
fi

echo ""
echo "═══ TEST 1 — fresh audio: stage → transcribe → archive ═══"
SEED=$(date +%s%N)
TEST1_FILE="$TMP/smoke-fresh-$SEED.ogg"
ffmpeg -y -loglevel error -f lavfi -i "sine=frequency=440:duration=12" -ac 1 -ar 16000 "$TEST1_FILE"
TEST1_SHA=$(sha256sum "$TEST1_FILE" | awk '{print $1}')
echo "  test file SHA: $TEST1_SHA"
cp "$TEST1_FILE" "$INBOX/smoke-fresh-$SEED.ogg"

# Poll up to 90s for archive entry
WAITED=0
while [ $WAITED -lt 90 ]; do
  [ -f "$ARCHIVE/$TEST1_SHA.ogg" ] && break
  sleep 3 && WAITED=$((WAITED + 3))
done
[ -f "$ARCHIVE/$TEST1_SHA.ogg" ] && pass "archived to $ARCHIVE/$TEST1_SHA.ogg (after ${WAITED}s)" || fail "archive entry never appeared after ${WAITED}s"
[ -f "$INBOX/smoke-fresh-$SEED.ogg" ] && fail "inbox file still present (archive didn't move it)" || pass "inbox file removed (archived)"
[ -f "$TRANSCRIPTS/smoke-fresh-$SEED.json" ] && pass "transcript at expected per-original-basename path" || fail "transcript missing at $TRANSCRIPTS/smoke-fresh-$SEED.json"

echo ""
echo "═══ TEST 2 — duplicate content (different name) → quarantined ═══"
cp "$TEST1_FILE" "$INBOX/smoke-fresh-DUPE-$SEED.ogg"
sleep 8
QUARANTINED=$(find "$DUPLICATES/$TEST1_SHA/" -name "*smoke-fresh-DUPE-$SEED*" 2>/dev/null | head -1)
[ -n "$QUARANTINED" ] && pass "quarantined to $QUARANTINED" || fail "duplicate not moved to /duplicates/$TEST1_SHA/"
[ -f "$INBOX/smoke-fresh-DUPE-$SEED.ogg" ] && fail "inbox copy still present (quarantine didn't move it)" || pass "inbox copy removed"
# CRITICAL: no SECOND transcript should appear (we're already at TEST1_SHA.json)
# The transcript filename is derived from the inbox basename, which differs,
# so the absence of smoke-fresh-DUPE-*.json proves no second run happened.
[ -f "$TRANSCRIPTS/smoke-fresh-DUPE-$SEED.json" ] && fail "duplicate produced a SECOND transcript (dedup failed)" || pass "no second transcription started (dedup worked)"

echo ""
echo "═══ TEST 3 (Phase 2.5 regression) — two unique files in same subdir ═══"
SEED2=$(date +%s%N)
T3A="$TMP/smoke-T3A-$SEED2.ogg"
T3B="$TMP/smoke-T3B-$SEED2.ogg"
ffmpeg -y -loglevel error -f lavfi -i "sine=frequency=523:duration=15" -ac 1 -ar 16000 "$T3A"
sleep 1
ffmpeg -y -loglevel error -f lavfi -i "sine=frequency=659:duration=15" -ac 1 -ar 16000 "$T3B"
T3A_SHA=$(sha256sum "$T3A" | awk '{print $1}')
T3B_SHA=$(sha256sum "$T3B" | awk '{print $1}')
cp "$T3A" "$INBOX/smoke-A-$SEED2.ogg"
cp "$T3B" "$INBOX/smoke-B-$SEED2.ogg"
# Poll for both archives
WAITED=0
while [ $WAITED -lt 60 ]; do
  [ -f "$ARCHIVE/$T3A_SHA.ogg" ] && [ -f "$ARCHIVE/$T3B_SHA.ogg" ] && break
  sleep 3 && WAITED=$((WAITED + 3))
done
[ -f "$ARCHIVE/$T3A_SHA.ogg" ] && pass "smoke-A archived" || fail "smoke-A NOT archived"
[ -f "$ARCHIVE/$T3B_SHA.ogg" ] && pass "smoke-B archived" || fail "smoke-B NOT archived"
[ -f "$TRANSCRIPTS/smoke-A-$SEED2.json" ] && pass "smoke-A transcript at unique path" || fail "smoke-A transcript missing"
[ -f "$TRANSCRIPTS/smoke-B-$SEED2.json" ] && pass "smoke-B transcript at unique path" || fail "smoke-B transcript missing"

echo ""
echo "═══ TEST 4 — /api/v1/dedup-stats counter deltas ═══"
END_STATS=$(curl -fsS "$API_URL/api/v1/dedup-stats" || echo '{}')
read -r END_STAGED END_ARCHIVED END_DEDUP < <(echo "$END_STATS" \
  | python3 -c "import sys,json; d=json.load(sys.stdin).get('counters',{}); print(d.get('jobsStaged',0), d.get('jobsArchived',0), d.get('dedupSaved',0))")
DELTA_STAGED=$((END_STAGED - START_STAGED))
DELTA_ARCHIVED=$((END_ARCHIVED - START_ARCHIVED))
DELTA_DEDUP=$((END_DEDUP - START_DEDUP))
echo "  Δ staged=$DELTA_STAGED  archived=$DELTA_ARCHIVED  dedup=$DELTA_DEDUP"
[ "$DELTA_STAGED" -ge 3 ] && pass "jobsStaged incremented (≥3 expected from 3 new files)" || fail "jobsStaged delta $DELTA_STAGED < 3"
[ "$DELTA_ARCHIVED" -ge 3 ] && pass "jobsArchived incremented (≥3 expected)" || fail "jobsArchived delta $DELTA_ARCHIVED < 3"
[ "$DELTA_DEDUP" -ge 1 ] && pass "dedupSaved incremented (≥1 from the duplicate)" || fail "dedupSaved delta $DELTA_DEDUP < 1"

echo ""
echo "═══ TEST 5 — /api/v1/metrics exposes the Phase 3 counters ═══"
METRICS=$(curl -fsS "$API_URL/api/v1/metrics" || echo '')
for METRIC in transcription_dedup_saved_total transcription_jobs_staged_total transcription_jobs_archived_total transcription_jobs_terminal_failed_total; do
  echo "$METRICS" | grep -q "^# HELP $METRIC" && pass "$METRIC exposed" || fail "$METRIC NOT exposed by /metrics"
done

echo ""
if [ "$FAILED" -eq 0 ]; then
  echo "═══ ✅ ALL E2E SMOKE TESTS PASSED ═══"
  exit 0
else
  echo "═══ ❌ E2E SMOKE FAILED — see ✗ marks above ═══"
  exit 1
fi
