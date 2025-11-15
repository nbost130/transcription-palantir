.PHONY: help dev-up dev-down dev-restart dev-logs clean test build install

# Colors
BLUE := \033[0;34m
GREEN := \033[0;32m
YELLOW := \033[1;33m
NC := \033[0m # No Color

help: ## Show this help message
	@echo "$(BLUE)🔮 Transcription Palantir - Development Commands$(NC)"
	@echo "================================================="
	@echo ""
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "  $(GREEN)%-20s$(NC) %s\n", $$1, $$2}'
	@echo ""

install: ## Install dependencies
	@echo "$(BLUE)📦 Installing dependencies...$(NC)"
	@bun install

dev-up: ## Start development services (Redis, Redis Commander)
	@./scripts/dev-start.sh

dev-down: ## Stop development services
	@./scripts/dev-stop.sh

dev-restart: ## Restart development services
	@./scripts/dev-restart.sh

dev-logs: ## Show logs from development services
	@./scripts/dev-logs.sh

dev: dev-up ## Start development environment and app
	@echo "$(YELLOW)Starting application in development mode...$(NC)"
	@bun run dev

build: ## Build TypeScript project
	@echo "$(BLUE)🔨 Building project...$(NC)"
	@bun run build

test: ## Run tests
	@echo "$(BLUE)🧪 Running tests...$(NC)"
	@bun test

test-integration: dev-up ## Run integration tests with Redis
	@echo "$(BLUE)🧪 Running integration tests...$(NC)"
	@echo "$(YELLOW)Waiting for Redis to be ready...$(NC)"
	@until docker exec palantir-redis-dev redis-cli ping > /dev/null 2>&1; do \
		echo "$(YELLOW)Redis not ready, waiting...$(NC)"; \
		sleep 1; \
	done
	@echo "$(GREEN)Redis is ready!$(NC)"
	@bun test tests/integration

clean: ## Clean build artifacts and Docker volumes
	@echo "$(YELLOW)🧹 Cleaning up...$(NC)"
	@rm -rf dist
	@rm -rf node_modules
	@docker-compose -f docker-compose.dev.yml down -v
	@echo "$(GREEN)✅ Cleanup complete$(NC)"

redis-cli: ## Open Redis CLI
	@docker exec -it palantir-redis-dev redis-cli

redis-monitor: ## Monitor Redis commands in real-time
	@docker exec -it palantir-redis-dev redis-cli MONITOR

docker-prod: ## Start production Docker environment
	@docker-compose up -d

docker-prod-down: ## Stop production Docker environment
	@docker-compose down

docker-prod-logs: ## Show production logs
	@docker-compose logs -f

docker-build: ## Build Docker images
	@docker-compose build

status: ## Show status of all services
	@echo "$(BLUE)📊 Service Status$(NC)"
	@echo "==================="
	@docker-compose -f docker-compose.dev.yml ps
	@echo ""
	@echo "$(BLUE)📈 Application Status$(NC)"
	@echo "======================"
	@curl -s http://localhost:3000/health 2>/dev/null | jq . || echo "API not running"

.DEFAULT_GOAL := help
