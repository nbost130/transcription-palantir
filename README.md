# 🔮 Transcription Palantir

*Modern TypeScript transcription system with BullMQ, Redis, and Whisper.cpp integration*

> **Palantir** - The seeing stones of Middle-earth that enable communication across vast distances. Like the ancient palantíri, this system "sees" audio content and communicates its transcribed essence across your infrastructure.

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
│   Fastify API   │    │   Job Database   │    │   Whisper.cpp   │
│   (Dashboard)   │    │   (Redis/SQLite) │    │   (Transcriber) │
└─────────────────┘    └──────────────────┘    └─────────────────┘
```

## 🛠️ Technology Stack

- **Runtime**: Bun (primary) / Node.js (fallback)
- **Language**: TypeScript with strict type checking
- **Queue**: BullMQ + Redis
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

### API Endpoints

- `GET /health` - Health check
- `GET /metrics` - Prometheus metrics
- `GET /api/jobs` - List transcription jobs
- `POST /api/jobs` - Create new transcription job
- `GET /api/jobs/:id` - Get job status
- `DELETE /api/jobs/:id` - Cancel job

### Dashboard

Access the real-time dashboard at `http://localhost:3000/dashboard`

## 🧪 Development

### Running Tests

```bash
bun test              # Run all tests
bun test --watch      # Watch mode
bun test --coverage   # With coverage
```

### Code Quality

```bash
bun run lint          # ESLint
bun run lint:fix      # Auto-fix issues
bun run format        # Prettier formatting
```

## 🚢 Deployment

### Staging Deployment

```bash
bun run deploy:staging
```

### Production Deployment

```bash
bun run deploy:production
```

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
