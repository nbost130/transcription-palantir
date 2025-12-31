import { FastifyInstance } from 'fastify';
import { logger } from '../../utils/logger.js';
import { ReconciliationService } from '../../services/reconciliation.js';
import { transcriptionQueue } from '../../services/queue.js';
import { appConfig } from '../../config/index.js';
export async function systemRoutes(fastify: FastifyInstance) {
    // POST /system/reconcile
    // Manually trigger reconciliation process
    fastify.post('/system/reconcile', async (request, reply) => {
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
