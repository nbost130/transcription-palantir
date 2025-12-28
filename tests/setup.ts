import { mock } from 'bun:test';
import { mockQueueInstance, mockWorkerInstance, mockQueueEventsInstance } from './mocks';

// Mock BullMQ
mock.module('bullmq', () => ({
    Queue: mock(() => mockQueueInstance),
    Worker: mock(() => mockWorkerInstance),
    QueueEvents: mock(() => mockQueueEventsInstance),
    Job: class { },
}));

// Mock Redis
mock.module('ioredis', () => {
    class Redis {
        constructor() {
            // console.log('Redis mock constructor called');
        }
        on = mock(() => { });
        quit = mock(async () => { });
        status = 'ready';
        connect = mock(async () => { });
        disconnect = mock(async () => { });
        duplicate = mock(() => this);
    };
    return {
        Redis,
        default: Redis,
    };
});
