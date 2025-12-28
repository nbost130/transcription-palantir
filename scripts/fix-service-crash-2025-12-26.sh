#!/usr/bin/env bash
#
# 🔮 Transcription Palantir - Emergency Service Recovery Script
# Date: 2025-12-26
# Purpose: Fix service crash loop and clean stale jobs
#
# This script addresses the critical incident where:
# 1. Rogue process holding port 9003 prevents systemd service from starting
# 2. 20 stale failed jobs in queue attempting to process already-completed files
#
# Usage: bash scripts/fix-service-crash-2025-12-26.sh
#

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
SERVICE_NAME="transcription-palantir"
PORT=9003
API_URL="http://localhost:${PORT}/api/v1"

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}🔮 Transcription Palantir Recovery${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# Step 1: Check for rogue processes
echo -e "${YELLOW}[1/6] Checking for rogue processes on port ${PORT}...${NC}"
ROGUE_PIDS=$(lsof -ti :${PORT} 2>/dev/null || true)

if [ -n "$ROGUE_PIDS" ]; then
    echo -e "${RED}Found rogue process(es): ${ROGUE_PIDS}${NC}"
    for PID in $ROGUE_PIDS; do
        echo -e "${YELLOW}  Killing PID ${PID}...${NC}"
        ps -p ${PID} -o pid,ppid,cmd,etime,user || true
        kill -9 ${PID} 2>/dev/null || true
        echo -e "${GREEN}  ✓ Killed PID ${PID}${NC}"
    done
else
    echo -e "${GREEN}✓ No rogue processes found${NC}"
fi
echo ""

# Step 2: Stop systemd service (if running)
echo -e "${YELLOW}[2/6] Stopping systemd service...${NC}"
systemctl --user stop ${SERVICE_NAME} 2>/dev/null || true
sleep 2
echo -e "${GREEN}✓ Service stopped${NC}"
echo ""

# Step 3: Verify port is free
echo -e "${YELLOW}[3/6] Verifying port ${PORT} is free...${NC}"
if lsof -ti :${PORT} >/dev/null 2>&1; then
    echo -e "${RED}✗ Port ${PORT} still in use!${NC}"
    lsof -i :${PORT}
    exit 1
else
    echo -e "${GREEN}✓ Port ${PORT} is free${NC}"
fi
echo ""

# Step 4: Start systemd service
echo -e "${YELLOW}[4/6] Starting systemd service...${NC}"
systemctl --user start ${SERVICE_NAME}
sleep 5

# Check service status
if systemctl --user is-active --quiet ${SERVICE_NAME}; then
    echo -e "${GREEN}✓ Service started successfully${NC}"
    systemctl --user status ${SERVICE_NAME} --no-pager -l | head -15
else
    echo -e "${RED}✗ Service failed to start${NC}"
    systemctl --user status ${SERVICE_NAME} --no-pager -l
    exit 1
fi
echo ""

# Step 5: Verify API health
echo -e "${YELLOW}[5/6] Checking API health...${NC}"
sleep 3
HEALTH_CHECK=$(curl -s "${API_URL}/health" || echo '{"status":"error"}')
HEALTH_STATUS=$(echo "$HEALTH_CHECK" | jq -r '.status // "error"')

if [ "$HEALTH_STATUS" = "healthy" ] || [ "$HEALTH_STATUS" = "ok" ]; then
    echo -e "${GREEN}✓ API is healthy${NC}"
    echo "$HEALTH_CHECK" | jq '.'
else
    echo -e "${RED}✗ API health check failed${NC}"
    echo "$HEALTH_CHECK"
    exit 1
fi
echo ""

# Step 6: Clean failed jobs
echo -e "${YELLOW}[6/6] Cleaning stale failed jobs...${NC}"

# Get count of failed jobs
FAILED_COUNT=$(curl -s "${API_URL}/jobs?status=failed" | jq '.data | length')
echo -e "Found ${FAILED_COUNT} failed jobs"

if [ "$FAILED_COUNT" -gt 0 ]; then
    echo -e "${YELLOW}Listing failed jobs:${NC}"
    curl -s "${API_URL}/jobs?status=failed" | jq -r '.data[] | "\(.fileName) - \(.error)"' | head -10
    
    echo ""
    echo -e "${YELLOW}Do you want to delete these failed jobs? (y/N)${NC}"
    read -r CONFIRM
    
    if [ "$CONFIRM" = "y" ] || [ "$CONFIRM" = "Y" ]; then
        # Delete each failed job
        FAILED_JOB_IDS=$(curl -s "${API_URL}/jobs?status=failed" | jq -r '.data[].jobId')
        for JOB_ID in $FAILED_JOB_IDS; do
            echo -e "  Deleting job ${JOB_ID}..."
            curl -s -X DELETE "${API_URL}/jobs/${JOB_ID}" >/dev/null || true
        done
        echo -e "${GREEN}✓ Failed jobs cleaned${NC}"
    else
        echo -e "${YELLOW}Skipped cleaning failed jobs${NC}"
    fi
else
    echo -e "${GREEN}✓ No failed jobs to clean${NC}"
fi
echo ""

# Final status report
echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}📊 Final Status Report${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

echo -e "${GREEN}Service Status:${NC}"
systemctl --user status ${SERVICE_NAME} --no-pager | grep -E "(Active|Main PID|Memory|CPU)" || true
echo ""

echo -e "${GREEN}Queue Status:${NC}"
curl -s "${API_URL}/jobs?limit=5" | jq '{
  total: .data | length,
  statuses: .data | group_by(.status) | map({status: .[0].status, count: length})
}'
echo ""

echo -e "${GREEN}Recent Jobs:${NC}"
curl -s "${API_URL}/jobs?limit=5" | jq -r '.data[] | "\(.status) - \(.fileName)"'
echo ""

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}✅ Recovery Complete!${NC}"
echo -e "${GREEN}========================================${NC}"

