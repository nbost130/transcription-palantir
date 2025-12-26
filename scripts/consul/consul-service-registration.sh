#!/bin/bash
# Consul Service Registration Helper
# Usage: consul-service-registration.sh <action> <service-name> <port> <health-endpoint> <display-name>
# Action: register | deregister
# Example: consul-service-registration.sh register transcription-palantir 9003 /api/v1/health/detailed "Transcription Palantir"

set -e

ACTION=$1
SERVICE_NAME=$2
PORT=$3
HEALTH_ENDPOINT=$4
DISPLAY_NAME=$5
CONSUL_ADDR="http://100.77.230.53:8500"
HOST_IP="100.77.230.53"

if [ "$ACTION" = "register" ]; then
  echo "Registering $SERVICE_NAME with Consul..."

  # Build tags from service name
  IFS='-' read -ra PARTS <<< "$SERVICE_NAME"
  TAGS_JSON=$(printf '%s\n' "${PARTS[@]}" | jq -R . | jq -s .)

  # Register service
  curl -X PUT "${CONSUL_ADDR}/v1/agent/service/register" \
    -H "Content-Type: application/json" \
    -d "{
      \"ID\": \"${SERVICE_NAME}\",
      \"Name\": \"${SERVICE_NAME}\",
      \"Tags\": ${TAGS_JSON},
      \"Port\": ${PORT},
      \"Address\": \"${HOST_IP}\",
      \"Meta\": {
        \"healthEndpoint\": \"${HEALTH_ENDPOINT}\",
        \"displayName\": \"${DISPLAY_NAME}\"
      }
    }" && echo "✅ Registered $SERVICE_NAME"

elif [ "$ACTION" = "deregister" ]; then
  echo "Deregistering $SERVICE_NAME from Consul..."
  curl -X PUT "${CONSUL_ADDR}/v1/agent/service/deregister/${SERVICE_NAME}" \
    && echo "✅ Deregistered $SERVICE_NAME"
else
  echo "Usage: $0 <register|deregister> <service-name> <port> <health-endpoint> <display-name>"
  exit 1
fi
