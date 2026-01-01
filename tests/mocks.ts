import { vi } from 'vitest';

export const mockQueueInstance = {
    add: vi.fn(async (name, data) => ({ id: 'job-123', name, data })),
    on: vi.fn(() => { }),
    close: vi.fn(async () => { }),
    getJob: vi.fn(async () => null),
    getJobCounts: vi.fn(async () => ({ waiting: 0, active: 0, completed: 0, failed: 0 })),
    getWaiting: vi.fn(async () => []),
    getActive: vi.fn(async () => []),
    getCompleted: vi.fn(async () => []),
    getFailed: vi.fn(async () => []),
    getDelayed: vi.fn(async () => []),
    pause: vi.fn(async () => { }),
    resume: vi.fn(async () => { }),
    clean: vi.fn(async () => []),
    waitUntilReady: vi.fn(async () => { }),
    getJobs: vi.fn(async () => []),
    getJobCountByTypes: vi.fn(async () => 0),
};

export const mockWorkerInstance = {
    on: vi.fn(() => { }),
    close: vi.fn(async () => { }),
};

export const mockQueueEventsInstance = {
    on: vi.fn(() => { }),
    close: vi.fn(async () => { }),
    waitUntilReady: vi.fn(async () => { }),
};

export const mockRedis = {
    on: vi.fn(() => { }),
    quit: vi.fn(async () => { }),
    status: 'ready',
    connect: vi.fn(async () => { }),
    disconnect: vi.fn(async () => { }),
    duplicate: vi.fn(() => mockRedis),
};
