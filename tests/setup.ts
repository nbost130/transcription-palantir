import { vi } from 'vitest';
import { mockQueueInstance, mockWorkerInstance, mockQueueEventsInstance } from './mocks';

// Mock BullMQ
vi.mock('bullmq', () => ({
    Queue: vi.fn(() => mockQueueInstance),
    Worker: vi.fn(() => mockWorkerInstance),
    QueueEvents: vi.fn(() => mockQueueEventsInstance),
    Job: class { },
}));

// Mock Redis
vi.mock('ioredis', () => {
    class Redis {
        constructor() {
            // console.log('Redis mock constructor called');
        }
        on = vi.fn(() => { });
        quit = vi.fn(async () => { });
        status = 'ready';
        connect = vi.fn(async () => { });
        disconnect = vi.fn(async () => { });
        duplicate = vi.fn(() => this);
    };
    return {
        Redis,
        default: Redis,
    };
});
