#!/bin/bash
# =============================================================================
# 🔮 Transcription Palantir - Development Logs Script
# =============================================================================
# Shows logs from all development services
# =============================================================================

set -e

# Colors
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}🔮 Transcription Palantir - Development Logs${NC}"
echo "============================================="
echo ""

# Check which service to show logs for
SERVICE=${1:-""}

if [ -z "$SERVICE" ]; then
    echo "Following logs for all services..."
    echo "Press Ctrl+C to exit"
    echo ""
    docker-compose -f docker-compose.dev.yml logs -f
else
    echo "Following logs for: $SERVICE"
    echo "Press Ctrl+C to exit"
    echo ""
    docker-compose -f docker-compose.dev.yml logs -f "$SERVICE"
fi
