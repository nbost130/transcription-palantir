# Mithrandir Unified API

**Version 2.0.0** - TypeScript Unified API for all Mithrandir services

## 🎯 Purpose

The Unified API serves as a **centralized monitoring and management interface** for all services running on Mithrandir. Instead of each service implementing its own API server infrastructure, services expose their data and the Unified API provides standardized endpoints for monitoring, management, and integration.

## 🏗️ Architecture Principles

### **Service Independence**
- ✅ **Services remain autonomous** - no dependencies on the Unified API
- ✅ **Services expose data** via files, databases, or simple interfaces
- ✅ **Unified API consumes** service data without modifying services
- ✅ **Clean separation** - services focus on their core functionality

### **Unified Interface**
- 🔌 **Single API endpoint** for all service monitoring
- 📊 **Standardized response formats** across all services
- 🛡️ **Centralized security** (rate limiting, CORS, authentication)
- 📚 **Auto-generated documentation** via Swagger/OpenAPI

### **Monitoring & Management**
- 👁️ **Real-time status** of all services
- 📈 **Performance metrics** and health checks
- 🔄 **Service control** (start, stop, restart where applicable)
- 🚨 **Alerting integration** for service failures

## 🚀 Current Services

### **System Services**
- **SSH Status** - Connection and authentication monitoring
- **VNC Status** - Remote desktop service monitoring
- **System Health** - Overall system metrics and status

### **Transcription Service** *(New)*
- **Processing Stats** - Queue status, completion rates, worker health
- **Job Monitoring** - Recent jobs, Orbis course progress, error tracking
- **Service Management** - Status checks, restart capabilities
- **Performance Metrics** - Processing rates, system resource usage

## 📡 API Endpoints

### **Core System**
```
GET  /health              - Overall system health
GET  /status              - Comprehensive system status
GET  /ssh-status          - SSH service status
POST /restart-ssh         - Restart SSH service
GET  /monitoring/health   - Detailed health metrics
```

### **Transcription Monitoring**
```
GET  /transcription/stats     - Processing statistics
GET  /transcription/status    - Service status and uptime
GET  /transcription/jobs      - Recent job history
GET  /transcription/orbis     - Orbis course job status
POST /transcription/restart   - Restart transcription service
GET  /transcription/health    - Transcription system health
```

## 🔧 Technical Stack

- **Framework**: Fastify (high-performance Node.js)
- **Language**: TypeScript for type safety
- **Documentation**: Swagger/OpenAPI auto-generation
- **Security**: Helmet, CORS, Rate limiting
- **Logging**: Pino structured logging
- **Validation**: Zod schema validation

## 🏃‍♂️ Running the API

### **Development**
```bash
npm run dev    # Watch mode with hot reload
```

### **Production**
```bash
npm run build  # Compile TypeScript
npm start      # Run compiled JavaScript
```

### **Docker** *(if configured)*
```bash
docker-compose up -d
```

## 📊 Service Integration Pattern

### **For New Services**

1. **Service Implementation**
   - Build your service independently
   - Expose data via SQLite DB, JSON files, or simple interfaces
   - Focus on core functionality, not API infrastructure

2. **Unified API Integration**
   - Add monitoring endpoints to `src/services/`
   - Create service-specific types in `src/types/`
   - Register routes in `src/server.ts`
   - Update this documentation

3. **Example Integration**
```typescript
// src/services/my-service.ts
export class MyService {
  async getStats() {
    // Read from service database/files
    return { status: 'healthy', processed: 100 };
  }
}

// src/server.ts
fastify.get('/my-service/stats', async () => {
  return await myService.getStats();
});
```

## 🔍 Monitoring Philosophy

### **Read-Only by Default**
- Services maintain their own state
- API provides **monitoring** and **observability**
- Management actions (restart, etc.) are **explicit and logged**

### **Service Health Model**
```typescript
interface ServiceHealth {
  status: 'healthy' | 'warning' | 'error';
  uptime: string;
  lastActivity: string;
  metrics: Record<string, number>;
  details?: any;
}
```

## 🚨 Error Handling

- **Graceful degradation** - API remains available even if services are down
- **Detailed error responses** with actionable information
- **Structured logging** for debugging and monitoring
- **Health check endpoints** for load balancer integration

## 📈 Future Enhancements

- **WebSocket support** for real-time updates
- **Metrics collection** (Prometheus integration)
- **Authentication system** for secure access
- **Service discovery** for dynamic service registration
- **Dashboard UI** for visual monitoring

## 🤝 Contributing

When adding new service integrations:

1. Follow the **service independence** principle
2. Add comprehensive **TypeScript types**
3. Include **Swagger documentation** schemas
4. Update this **README** with new endpoints
5. Test **error scenarios** and edge cases

---

**The Unified API: One interface to monitor them all** 🧙‍♂️
