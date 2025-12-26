import { FastifyInstance } from 'fastify';
import axios from 'axios';

interface ServiceDetails {
  name: string;
  identifier: string;
  status: 'healthy' | 'unhealthy';
  url: string;
  port: number;
  uptime?: number;
  version?: string;
  error?: string;
  details?: any;
  lastChecked: string;
}

interface ServicesSummary {
  total: number;
  healthy: number;
  unhealthy: number;
  healthPercentage: number;
}

interface ServicesHealthResponse {
  services: ServiceDetails[];
  summary: ServicesSummary;
}

interface ApiResponse<T> {
  success: boolean;
  data: T;
  timestamp: string;
  error?: string;
}

interface ConsulService {
  ID: string;
  Service: string;
  Tags: string[];
  Port: number;
  Address: string;
  Meta: Record<string, string>;
}

// Port mapping for Docker services (internal IP:port → external port)
const DOCKER_PORT_MAPPING: Record<string, { externalPort: number; healthEndpoint?: string }> = {
  'grafana:3000': { externalPort: 3002, healthEndpoint: '/api/health' },
  'cadvisor:8080': { externalPort: 8081, healthEndpoint: '/healthz' },
  'node-exporter:9100': { externalPort: 9100, healthEndpoint: '/metrics' },
  'portainer:9000': { externalPort: 9001, healthEndpoint: '/' },
  'uptime-kuma:3001': { externalPort: 3001, healthEndpoint: '/' },
};

// Services to exclude from monitoring (internal Consul ports, etc.)
const EXCLUDED_SERVICES = [
  'consul-8301',
  'consul-8302',
  'consul-8600',
  'consul',
];

const CONSUL_URL = 'http://100.77.230.53:8500';
const HOST_IP = '100.77.230.53';

async function fetchConsulServices(): Promise<ConsulService[]> {
  try {
    const response = await axios.get<Record<string, ConsulService>>(`${CONSUL_URL}/v1/agent/services`);
    return Object.values(response.data);
  } catch (error: any) {
    throw new Error(`Failed to fetch Consul services: ${error.message}`);
  }
}

function buildServiceUrl(service: ConsulService): { url: string; healthEndpoint: string } {
  const isDockerService = service.Address.startsWith('172.');

  if (isDockerService) {
    // Map Docker internal IP to external port
    const key = `${service.Service}:${service.Port}`;
    const mapping = DOCKER_PORT_MAPPING[key];

    if (mapping) {
      return {
        url: `http://${HOST_IP}:${mapping.externalPort}`,
        healthEndpoint: mapping.healthEndpoint || '/',
      };
    }

    // No mapping found - skip this service
    return { url: '', healthEndpoint: '' };
  }

  // Host service - use address and port directly
  const healthEndpoint = service.Meta?.healthEndpoint || '/';
  return {
    url: `http://${service.Address}:${service.Port}`,
    healthEndpoint: healthEndpoint === 'tcp' ? '' : healthEndpoint,
  };
}

async function checkServiceHealth(service: ConsulService): Promise<ServiceDetails> {
  const lastChecked = new Date().toISOString();
  const { url, healthEndpoint } = buildServiceUrl(service);

  // If no URL mapping found, skip this service
  if (!url) {
    return null as any; // Will be filtered out
  }

  const displayName = service.Meta?.displayName ||
    service.Service.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

  try {
    // TCP check for Redis
    if (healthEndpoint === '') {
      if (service.Service === 'redis') {
        // For Redis, just check if port is open
        try {
          await axios.get(`${url}`, { timeout: 3000 });
          // Redis won't respond to HTTP, so a connection error is expected
        } catch (error: any) {
          // Connection refused = unhealthy, connection timeout = healthy (port open but not HTTP)
          const isHealthy = error.code !== 'ECONNREFUSED';
          return {
            name: displayName,
            identifier: service.ID,
            status: isHealthy ? 'healthy' : 'unhealthy',
            url,
            port: service.Port,
            error: isHealthy ? undefined : 'Connection refused',
            lastChecked,
          };
        }
      }

      return {
        name: displayName,
        identifier: service.ID,
        status: 'unhealthy',
        url,
        port: service.Port,
        error: 'No health endpoint configured',
        lastChecked,
      };
    }

    // HTTP health check
    const response = await axios.get(`${url}${healthEndpoint}`, {
      timeout: 5000,
      validateStatus: (status) => status < 500,
    });

    const baseResult: ServiceDetails = {
      name: displayName,
      identifier: service.ID,
      status: response.status === 200 ? 'healthy' : 'unhealthy',
      url,
      port: service.Port,
      lastChecked,
    };

    // Extract details from transcription-palantir
    if (service.Service === 'transcription-palantir' && response.data) {
      if (typeof response.data.uptime === 'number') {
        baseResult.uptime = response.data.uptime;
      }
      if (response.data.version) {
        baseResult.version = response.data.version;
      }
      if (response.data.services || response.data.metrics) {
        baseResult.details = {
          services: response.data.services,
          metrics: response.data.metrics,
        };
      }
    } else if (service.Service === 'n8n' && response.data) {
      baseResult.details = response.data;
    }

    return baseResult;
  } catch (error: any) {
    return {
      name: displayName,
      identifier: service.ID,
      status: 'unhealthy',
      url,
      port: service.Port,
      error: error.message || 'Failed to connect',
      lastChecked,
    };
  }
}

export default async function servicesRoutes(fastify: FastifyInstance) {
  fastify.get('/api/services/health', {
    schema: {
      description: 'Check health status of all Mithrandir services (Consul-integrated)',
      tags: ['services'],
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                services: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      name: { type: 'string' },
                      identifier: { type: 'string' },
                      status: { type: 'string', enum: ['healthy', 'unhealthy'] },
                      url: { type: 'string' },
                      port: { type: 'number' },
                      uptime: { type: 'number' },
                      version: { type: 'string' },
                      error: { type: 'string' },
                      details: { type: 'object' },
                      lastChecked: { type: 'string' },
                    },
                  },
                },
                summary: {
                  type: 'object',
                  properties: {
                    total: { type: 'number' },
                    healthy: { type: 'number' },
                    unhealthy: { type: 'number' },
                    healthPercentage: { type: 'number' },
                  },
                },
              },
            },
            timestamp: { type: 'string' },
          },
        },
      },
    },
  }, async (request, reply) => {
    try {
      // Fetch all services from Consul
      const consulServices = await fetchConsulServices();

      // Filter out excluded services and those with no tags (internal services)
      const relevantServices = consulServices.filter(service =>
        !EXCLUDED_SERVICES.includes(service.Service) &&
        !EXCLUDED_SERVICES.includes(service.ID) &&
        service.Tags && service.Tags.length > 0
      );

      // Check health of all services in parallel
      const serviceChecks = await Promise.all(
        relevantServices.map(service => checkServiceHealth(service))
      );

      // Filter out null results (unmapped Docker services)
      const validServices = serviceChecks.filter(s => s !== null);

      // Calculate summary
      const total = validServices.length;
      const healthy = validServices.filter(s => s.status === 'healthy').length;
      const unhealthy = total - healthy;
      const healthPercentage = total > 0 ? Math.round((healthy / total) * 100) : 0;

      const healthData: ServicesHealthResponse = {
        services: validServices,
        summary: {
          total,
          healthy,
          unhealthy,
          healthPercentage,
        },
      };

      const response: ApiResponse<ServicesHealthResponse> = {
        success: true,
        data: healthData,
        timestamp: new Date().toISOString(),
      };

      return response;
    } catch (error: any) {
      fastify.log.error({ error }, 'Failed to fetch services from Consul');

      // Return error response
      return reply.code(503).send({
        success: false,
        error: `Failed to fetch services: ${error.message}`,
        timestamp: new Date().toISOString(),
      });
    }
  });
}
