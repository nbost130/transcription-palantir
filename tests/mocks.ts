import { mock } from 'bun:test';

export const mockQueueInstance = {
    add: mock(async (name, data) => ({ id: 'job-123', name, data })),
    on: mock(() => { }),
    close: mock(async () => { }),
    getJob: mock(async () => null),
    getJobCounts: mock(async () => ({ waiting: 0, active: 0, completed: 0, failed: 0 })),
    getWaiting: mock(async () => []),
    getActive: mock(async () => []),
    getCompleted: mock(async () => []),
    getFailed: mock(async () => []),
    getDelayed: mock(async () => []),
    pause: mock(async () => { }),
    resume: mock(async () => { }),
    clean: mock(async () => []),
    waitUntilReady: mock(async () => { }),
    getJobs: mock(async () => []),
    getJobCountByTypes: mock(async () => 0),
};

export const mockWorkerInstance = {
    on: mock(() => { }),
    close: mock(async () => { }),
};

export const mockQueueEventsInstance = {
    on: mock(() => { }),
    close: mock(async () => { }),
    waitUntilReady: mock(async () => { }),
};

export const mockRedis = {
    on: mock(() => { }),
    quit: mock(async () => { }),
    status: 'ready',
    connect: mock(async () => { }),
    disconnect: mock(async () => { }),
    duplicate: mock(() => mockRedis),
};
