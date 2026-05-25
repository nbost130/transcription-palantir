import type { FastifyInstance } from 'fastify';
import { retentionService } from '../../services/retention.js';
import { logger } from '../../utils/logger.js';

export async function systemRoutes(fastify: FastifyInstance) {
  // POST /system/cleanup
  // Trigger a one-off retention pass on demand. Returns the structured
  // RetentionReport so the caller sees what was deleted.
  fastify.post('/system/cleanup', async (_request, reply) => {
    logger.info('Manual retention cleanup triggered via API');
    try {
      const report = await retentionService.runOnce();
      return { success: true, report };
    } catch (error) {
      logger.error({ error }, 'Manual retention cleanup failed');
      reply.code(500);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });
}
