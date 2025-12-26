#!/bin/bash
CONSUL_ADDR="http://100.77.230.53:8500"

# Deregister existing services first
for service in n8n transcription-palantir unified-api admin-dashboard nginx redis ollama; do
  curl -X PUT "${CONSUL_ADDR}/v1/agent/service/deregister/${service}" 2>/dev/null
done

# Register without health checks (health checking will be done by Palantir API)
curl -X PUT "${CONSUL_ADDR}/v1/agent/service/register" -H "Content-Type: application/json" -d '{
  "ID": "n8n", "Name": "n8n", "Tags": ["automation", "workflows"], "Port": 5678, "Address": "100.77.230.53",
  "Meta": {"healthEndpoint": "/healthz", "displayName": "n8n Automation"}
}'

curl -X PUT "${CONSUL_ADDR}/v1/agent/service/register" -H "Content-Type: application/json" -d '{
  "ID": "transcription-palantir", "Name": "transcription-palantir", "Tags": ["transcription", "api", "core"], "Port": 9003, "Address": "100.77.230.53",
  "Meta": {"healthEndpoint": "/api/v1/health/detailed", "displayName": "Transcription Palantir"}
}'

curl -X PUT "${CONSUL_ADDR}/v1/agent/service/register" -H "Content-Type: application/json" -d '{
  "ID": "unified-api", "Name": "unified-api", "Tags": ["api", "core"], "Port": 8080, "Address": "100.77.230.53",
  "Meta": {"healthEndpoint": "/monitoring/health", "displayName": "Unified API"}
}'

curl -X PUT "${CONSUL_ADDR}/v1/agent/service/register" -H "Content-Type: application/json" -d '{
  "ID": "admin-dashboard", "Name": "admin-dashboard", "Tags": ["dashboard", "ui"], "Port": 3000, "Address": "100.77.230.53",
  "Meta": {"healthEndpoint": "/", "displayName": "Admin Dashboard"}
}'

curl -X PUT "${CONSUL_ADDR}/v1/agent/service/register" -H "Content-Type: application/json" -d '{
  "ID": "nginx", "Name": "nginx", "Tags": ["proxy", "web-server"], "Port": 80, "Address": "100.77.230.53",
  "Meta": {"healthEndpoint": "/", "displayName": "Nginx Proxy"}
}'

curl -X PUT "${CONSUL_ADDR}/v1/agent/service/register" -H "Content-Type: application/json" -d '{
  "ID": "redis", "Name": "redis", "Tags": ["database", "cache", "queue"], "Port": 6379, "Address": "100.77.230.53",
  "Meta": {"healthEndpoint": "tcp", "displayName": "Redis"}
}'

curl -X PUT "${CONSUL_ADDR}/v1/agent/service/register" -H "Content-Type: application/json" -d '{
  "ID": "ollama", "Name": "ollama", "Tags": ["ai", "llm"], "Port": 11434, "Address": "100.77.230.53",
  "Meta": {"healthEndpoint": "/", "displayName": "Ollama"}
}'

echo -e "\n✅ All services registered in Consul (without health checks)"
