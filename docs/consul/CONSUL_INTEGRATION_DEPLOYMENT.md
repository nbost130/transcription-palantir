# Consul Integration Deployment Guide

## Overview

This implements Full Consul Integration for dynamic service discovery in the Mithrandir infrastructure.

## Architecture

### Service Discovery Flow

1. **Consul** stores the service catalog
   - Docker services auto-registered by Registrator
   - Non-Docker services manually registered with metadata

2. **Palantir API** (`/api/services/health`) performs:
   - Queries Consul for all services
   - Maps Docker internal IPs to external ports
   - Executes health checks from the API (has access to all networks)
   - Returns unified health status

3. **Admin Dashboard** consumes the API endpoint (unchanged)

### Why This Approach?

- **Consul** excels at service discovery and catalog management
- **Palantir API** has network access to check health of both Docker and host services
- **Hybrid approach** combines strengths of both systems
- **No complex Docker networking** - health checks run from the API, not from within containers

## Deployment Steps

### 1. Copy New services.ts File

```bash
# On the server (100.77.230.53)
cd /home/nbost/transcription-palantir

# Replace with new Consul-integrated version
# (Transfer /tmp/services-consul.ts to the server)
cp /path/to/services-consul.ts src/api/routes/services.ts
```

### 2. Install Service Registration Script

```bash
# Copy the registration helper
sudo cp /tmp/consul-service-registration.sh /usr/local/bin/
sudo chmod +x /usr/local/bin/consul-service-registration.sh
```

### 3. Verify Services are Registered in Consul

```bash
curl -s http://100.77.230.53:8500/v1/agent/services | jq '.[] | {name: .Service, port: .Port, tags: .Tags}'
```

You should see all these services:
- n8n
- transcription-palantir
- unified-api
- admin-dashboard
- nginx
- redis
- ollama
- grafana
- cadvisor
- node-exporter
- portainer
- uptime-kuma

### 4. Restart Palantir API

```bash
# Rebuild TypeScript
cd /home/nbost/transcription-palantir
npm run build

# Restart systemd service
sudo systemctl restart transcription-palantir

# Check status
sudo systemctl status transcription-palantir
```

### 5. Test the Endpoint

```bash
# Test the new Consul-integrated endpoint
curl -s http://100.77.230.53:9003/api/services/health | jq '.data.summary'
```

Expected output:
```json
{
  "total": 13,
  "healthy": 10,
  "unhealthy": 3,
  "healthPercentage": 77
}
```

### 6. Verify Dashboard

Open: http://100.77.230.53:3000/services

You should now see **all services** dynamically discovered from Consul!

## Service Auto-Registration (Optional Enhancement)

To automatically register/deregister services when they start/stop:

### For Systemd Services

Add to each service's systemd unit file:

```ini
[Service]
# ... existing configuration ...

ExecStartPost=/usr/local/bin/consul-service-registration.sh register SERVICE_NAME PORT HEALTH_ENDPOINT "Display Name"
ExecStopPost=/usr/local/bin/consul-service-registration.sh deregister SERVICE_NAME PORT HEALTH_ENDPOINT "Display Name"
```

Example for n8n (`/etc/systemd/system/n8n.service`):

```ini
[Service]
ExecStartPost=/usr/local/bin/consul-service-registration.sh register n8n 5678 /healthz "n8n Automation"
ExecStopPost=/usr/local/bin/consul-service-registration.sh deregister n8n 5678 /healthz "n8n Automation"
```

Then reload systemd:
```bash
sudo systemctl daemon-reload
```

## Docker Service Mapping

The new `services.ts` includes these Docker port mappings:

| Service | Internal | External | Health Endpoint |
|---------|----------|----------|----------------|
| Grafana | 172.25.0.30:3000 | 3002 | /api/health |
| cAdvisor | 172.25.0.60:8080 | 8081 | /healthz |
| node-exporter | 172.25.0.50:9100 | 9100 | /metrics |
| Portainer | Internal:9000 | 9001 | / |
| Uptime Kuma | Internal:3001 | 3001 | / |

**Note**: These mappings are hardcoded in the `DOCKER_PORT_MAPPING` constant. If you change Docker port mappings, update this constant.

## Adding New Services

### Host Services

1. Register with Consul:
```bash
consul-service-registration.sh register my-service 8888 /health "My Service"
```

2. Service will automatically appear in dashboard on next refresh!

### Docker Services

1. Start the Docker container (Registrator auto-registers it)
2. Add port mapping to `DOCKER_PORT_MAPPING` in `services.ts` if needed
3. Rebuild and restart Palantir API

## Monitoring

View Consul UI:
```
http://100.77.230.53:8500/ui/dc1/services
```

View Palantir API logs:
```bash
journalctl -u transcription-palantir -f
```

## Troubleshooting

### Service Not Appearing

1. Check Consul registration:
   ```bash
   curl http://100.77.230.53:8500/v1/agent/services | jq '.["SERVICE_NAME"]'
   ```

2. Check if service is excluded:
   - Review `EXCLUDED_SERVICES` array in `services.ts`
   - Ensure service has tags (services without tags are filtered out)

### Health Check Failing

1. Check health endpoint manually:
   ```bash
   curl http://100.77.230.53:PORT/HEALTH_ENDPOINT
   ```

2. Review Palantir API logs for error details

3. Verify port mapping for Docker services

### Consul Connection Issues

1. Verify Consul is running:
   ```bash
   docker ps | grep consul
   ```

2. Check Consul accessibility:
   ```bash
   curl http://100.77.230.53:8500/v1/status/leader
   ```

## Files Created

- `/tmp/services-consul.ts` - New Consul-integrated services endpoint
- `/tmp/consul-service-registration.sh` - Helper script for service registration
- `/tmp/register-services-no-checks.sh` - Initial registration of all non-Docker services

## Next Steps

1. Deploy the new `services.ts` file
2. Test the endpoint
3. Verify dashboard displays all services
4. (Optional) Add systemd hooks for auto-registration
5. (Optional) Add more Docker port mappings as needed

## Benefits Achieved

✅ **Dynamic Service Discovery** - New services automatically discovered
✅ **Centralized Catalog** - Consul as single source of truth
✅ **No Hardcoded Config** - Services defined in Consul, not code
✅ **Automatic Docker Discovery** - Registrator handles Docker containers
✅ **Flexible Health Checks** - Performed by API with full network access
✅ **Easy Service Addition** - Just register with Consul, no code changes
✅ **Scalable Architecture** - Add services without touching the codebase
