# 🔮 Transcription Palantir

*Modern TypeScript transcription system with BullMQ, Redis, and Whisper.cpp integration*

> **✨ Automated Deployment:** Push to `main` and changes deploy automatically to production!

> **Palantir** - The seeing stones of Middle-earth that enable communication across vast distances. Like the ancient palantíri, this system "sees" audio content and communicates its transcribed essence across your infrastructure.

## 🎯 Service Role

**Transcription Palantir is a BACKEND SERVICE** - it focuses exclusively on audio transcription processing. It is NOT intended for direct frontend access.

### **Access Pattern:**
- ✅ **Frontends** → Access via **Mithrandir Unified API** (port 8080) at `/transcription/*`
- ✅ **Backend Services** → Can access directly at port 9003 for service-to-service communication
- ❌ **DO NOT** configure frontends to access port 9003 directly

The Unified API acts as an API Gateway/BFF (Backend for Frontend), providing:
- Consistent API contracts across all services
- Centralized CORS, authentication, and rate limiting
- Service abstraction and flexibility
- Data aggregation from multiple backend services

## 🚀 Features

- **Modern Queue System**: BullMQ + Redis for robust job management
- **High Performance**: Whisper.cpp integration for fast transcription
- **Scalable Architecture**: Auto-scaling workers with PM2/Docker
- **Real-time Monitoring**: WebSocket dashboard with live updates
- **Type Safety**: Full TypeScript coverage with strict checking
- **Production Ready**: Health checks, metrics, and comprehensive logging

## 🏗️ Architecture

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   File Watcher  │───▶│   BullMQ Queue   │───▶│  Worker Cluster │
│   (Chokidar)    │    │   (Redis)        │    │   (PM2/Docker)  │
└─────────────────┘    └──────────────────┘    └─────────────────┘
         │                       │                       │
         ▼                       ▼                       ▼
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Fastify API   │    │   Single Source  │    │   Whisper.cpp   │
│   (Dashboard)   │    │   of Truth       │    │   (Transcriber) │
└─────────────────┘    │   (Redis Only)   │    └─────────────────┘
                       └──────────────────┘
```

**🗑️ SQLite Retired**: As of 2025-11-21, SQLite database was permanently retired. BullMQ (Redis) is now the single source of truth for all job data, eliminating sync issues and simplifying the architecture. See `SQLITE_RETIREMENT_NOTICE.md` for details.

## 🛠️ Technology Stack

- **Runtime**: Bun (primary) / Node.js (fallback)
- **Language**: TypeScript with strict type checking
- **Queue**: BullMQ + Redis (single source of truth, SQLite retired)
- **API**: Fastify with Swagger documentation
- **Transcription**: Whisper.cpp (faster than Python alternatives)
- **Process Management**: PM2 / Docker Swarm
- **Monitoring**: Prometheus metrics + custom dashboard

## 📦 Installation

### Prerequisites

- **Bun** >= 1.0.0 (or Node.js >= 18.0.0)
- **Redis** >= 6.0.0
- **Whisper.cpp** (compiled binary)

### Quick Start

```bash
# Clone and setup
git clone <repository-url>
cd transcription-palantir
bun install

# Configure environment
cp .env.example .env
# Edit .env with your settings

# Start Redis (if not running)
redis-server

# Development mode
bun run dev

# Production build
bun run build
bun run start
```

## 🔧 Configuration

### Environment Variables

```bash
# Core Settings
NODE_ENV=development
PORT=3000
LOG_LEVEL=info

# Redis Configuration
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=

# Whisper Configuration
WHISPER_MODEL=small
WHISPER_BINARY_PATH=/usr/local/bin/whisper
COMPUTE_TYPE=int8

# File Processing
WATCH_DIRECTORY=/path/to/audio/files
OUTPUT_DIRECTORY=/path/to/transcripts
MAX_WORKERS=4
```

## 🚀 Usage

### Starting Services

```bash
# Start all services
bun run docker:run

# Or start individually
bun run start:api      # API server
bun run start:worker   # Transcription workers
bun run start:watcher  # File watcher
```

### API Endpoints (Internal - Port 9003)

**⚠️ These endpoints are for internal/backend use only. Frontends should access via Unified API.**

- `GET /api/v1/health` - Health check
- `GET /api/v1/metrics` - Prometheus metrics
- `GET /api/v1/jobs` - List transcription jobs
- `POST /api/v1/jobs` - Create new transcription job
- `GET /api/v1/jobs/:id` - Get job status
- `DELETE /api/v1/jobs/:id` - Cancel job
- `GET /api/v1/monitor/queue` - Queue monitoring
- `GET /api/v1/monitor/workers` - Worker status
- `GET /api/v1/monitor/status` - System status

### Frontend Access (via Unified API - Port 8080)

**✅ Frontends should use these endpoints:**

- `GET http://mithrandir:8080/transcription/jobs` - List jobs (proxied to Palantir)
- `POST http://mithrandir:8080/transcription/jobs` - Create job (proxied to Palantir)
- `GET http://mithrandir:8080/transcription/jobs/:id` - Get job (proxied to Palantir)
- `GET http://mithrandir:8080/api/dashboard/stats` - Dashboard statistics
- `GET http://mithrandir:8080/api/dashboard/activity` - Recent activity

See [Mithrandir Unified API documentation](../mithrandir-unified-api/README.md) for complete API reference.

## 🧪 Development

### Running Tests

```bash
npm test              # Run all tests (using Vitest)
npm run test:watch    # Watch mode
npm run test:coverage # With coverage
```

### Code Quality

```bash
bun run lint          # ESLint
bun run lint:fix      # Auto-fix issues
bun run format        # Prettier formatting
```

## 🚢 Deployment

### systemd (Mithrandir Production)

Palantir runs as a user-level systemd service on Mithrandir. The service file is at `scripts/transcription-palantir.service`.

**Install the service:**
```bash
# Copy service file to systemd user directory
cp scripts/transcription-palantir.service ~/.config/systemd/user/transcription-palantir.service

# Reload, enable, and start
systemctl --user daemon-reload
systemctl --user enable transcription-palantir
systemctl --user start transcription-palantir

# Check status
systemctl --user status transcription-palantir
```

**Deploy code updates:**
```bash
# On Mithrandir
cd ~/transcription-palantir
git pull
bun install
bun run build
systemctl --user restart transcription-palantir
```

#### Zombie Process Prevention

The systemd unit includes three layers of defense against orphaned bun child processes:

1. **`KillMode=control-group`** - Kills the entire cgroup (main process + all children) on stop. This is the primary defense.
2. **`TimeoutStopSec=15`** - If graceful shutdown hangs, systemd sends SIGKILL after 15 seconds.
3. **`ExecStopPost=fuser -k 9003/tcp`** - Force-kills anything still bound to port 9003 after stop.

> **Incident (2026-02-01 to 2026-02-20):** Palantir received SIGTERM but a bun child process survived and held port 9003 at 99.9% CPU for 19 days. The systemd service couldn't restart because of EADDRINUSE, producing 1,019 failed restart attempts in the log. The zombie was only cleared by manual `kill -9`. The three systemd directives above were added to prevent recurrence.

### Docker Deployment

```bash
# Build and run with Docker Compose
bun run docker:build
bun run docker:run

# Scale workers
docker-compose up --scale worker=4
```

## 📊 Monitoring

- **Health Checks**: `/health` endpoint with detailed system status
- **Metrics**: Prometheus-compatible metrics at `/metrics`
- **Logging**: Structured JSON logs with configurable levels
- **Dashboard**: Real-time job monitoring with WebSocket updates

## 🔒 Security

- **Rate Limiting**: Configurable API rate limits
- **CORS**: Proper cross-origin resource sharing
- **Helmet**: Security headers and protection
- **Input Validation**: Zod schema validation

## 📖 API Versioning

The Transcription Palantir API uses semantic versioning with URL-based version prefixes (`/api/v1/*`). We maintain backward compatibility and provide clear migration paths for breaking changes.

**Key Points:**
- Current version: **v1** (`/api/v1/*`)
- Breaking changes require new version prefix (e.g., `/api/v2/*`)
- Non-breaking changes can be added to existing version
- OpenAPI spec available at `/documentation/json`
- Interactive API docs at `/docs`

See [API Versioning Policy](./docs/API_VERSIONING.md) for complete details on:
- Breaking vs non-breaking changes
- Version support policy
- Migration guidelines

## 🔧 Consumer Type Generation

Consumer applications can automatically generate TypeScript types from the OpenAPI specification for type-safe API integration.

**Quick Start:**
```bash
# Install openapi-typescript
npm install --save-dev openapi-typescript

# Add to package.json
{
  "scripts": {
    "generate:types": "openapi-typescript http://palantir.tailnet:3001/documentation/json -o src/types/palantir.d.ts"
  }
}

# Generate types
npm run generate:types
```

**Benefits:**
- ✅ Type-safe API client code
- ✅ Compile-time contract enforcement
- ✅ Automatic detection of breaking changes
- ✅ IDE autocomplete and IntelliSense

See [Consumer Type Generation Guide](./docs/CONSUMER_TYPE_GENERATION.md) for:
- Complete setup instructions
- Usage examples
- Best practices
- Troubleshooting

## 📚 Documentation

- [API Documentation](./docs/api.md)
- [Architecture Guide](./docs/architecture.md)
- [Deployment Guide](./docs/deployment.md)
- [Contributing Guidelines](./docs/contributing.md)

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests
5. Submit a pull request

## 📄 License

MIT License - see [LICENSE](./LICENSE) file for details.

---

*Built with ❤️ for the Mithrandir ecosystem*
