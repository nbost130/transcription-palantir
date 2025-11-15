#!/bin/bash
# =============================================================================
# 🔮 Transcription Palantir - Development Restart Script
# =============================================================================
# Restarts all development services
# =============================================================================

set -e

# Colors
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${BLUE}🔮 Restarting Transcription Palantir Development Services${NC}"
echo "=========================================================="
echo ""

echo -e "${YELLOW}🔄 Restarting services...${NC}"
./scripts/dev-stop.sh
sleep 2
./scripts/dev-start.sh
