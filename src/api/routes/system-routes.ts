import type { FastifyInstance } from 'fastify';
import { appConfig } from '../../config/index.js';
import { transcriptionQueue } from '../../services/queue.js';
import { ReconciliationService } from '../../services/reconciliation.js';
import { logger } from '../../utils/logger.js';
export async function systemRoutes(fastify: FastifyInstance) {
  // POST /system/reconcile
  // Manually trigger reconciliation process
  fastify.post('/system/reconcile', async (_request, reply) => {
    logger.info('Manual reconciliation triggered via API');

    try {
      const service = new ReconciliationService(transcriptionQueue, appConfig);
      const report = await service.reconcileOnBoot();

      return {
        success: true,
        report,
      };
    } catch (error) {
      logger.error({ error }, 'Manual reconciliation failed');
      reply.code(500);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });
}
