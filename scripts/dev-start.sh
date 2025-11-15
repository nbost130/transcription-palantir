#!/bin/bash
# =============================================================================
# 🔮 Transcription Palantir - Development Start Script
# =============================================================================
# Starts all development services (Redis, Redis Commander)
# and prepares the environment for local development
# =============================================================================

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🔮 Transcription Palantir - Development Environment${NC}"
echo "=================================================="
echo ""

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo -e "${RED}❌ Error: Docker is not running${NC}"
    echo "Please start Docker and try again."
    exit 1
fi

# Check if docker-compose is available
if ! command -v docker-compose &> /dev/null; then
    echo -e "${RED}❌ Error: docker-compose not found${NC}"
    echo "Please install docker-compose and try again."
    exit 1
fi

echo -e "${YELLOW}📦 Creating required directories...${NC}"
mkdir -p .docker/redis-data
mkdir -p /tmp/audio-input
mkdir -p /tmp/transcripts
mkdir -p /tmp/transcripts/completed
mkdir -p /tmp/transcripts/failed

echo -e "${YELLOW}🐳 Starting Docker services...${NC}"
docker-compose -f docker-compose.dev.yml up -d

echo ""
echo -e "${GREEN}✅ Development services started!${NC}"
echo ""
echo "Services:"
echo "  🔴 Redis:           localhost:6379"
echo "  🌐 Redis Commander: http://localhost:8081"
echo ""
echo "Next steps:"
echo "  1. Run: ${BLUE}bun run dev${NC} to start the application"
echo "  2. Access API docs: ${BLUE}http://localhost:3000/docs${NC}"
echo "  3. Monitor Redis: ${BLUE}http://localhost:8081${NC}"
echo ""
echo "Useful commands:"
echo "  📊 View logs: ${BLUE}docker-compose -f docker-compose.dev.yml logs -f${NC}"
echo "  🛑 Stop services: ${BLUE}./scripts/dev-stop.sh${NC}"
echo "  🔄 Restart: ${BLUE}./scripts/dev-restart.sh${NC}"
echo ""
