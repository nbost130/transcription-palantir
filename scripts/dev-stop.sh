#!/bin/bash
# =============================================================================
# 🔮 Transcription Palantir - Development Stop Script
# =============================================================================
# Stops all development services
# =============================================================================

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}🔮 Stopping Transcription Palantir Development Services${NC}"
echo "======================================================="
echo ""

if ! docker info > /dev/null 2>&1; then
    echo -e "${RED}❌ Error: Docker is not running${NC}"
    exit 1
fi

echo -e "${YELLOW}🛑 Stopping Docker services...${NC}"
docker-compose -f docker-compose.dev.yml down

echo ""
echo -e "${GREEN}✅ All services stopped!${NC}"
echo ""
echo "Data preserved in:"
echo "  📁 .docker/redis-data/"
echo "  📁 /tmp/audio-input/"
echo "  📁 /tmp/transcripts/"
echo ""
echo "To remove all data: ${BLUE}docker-compose -f docker-compose.dev.yml down -v${NC}"
echo ""
