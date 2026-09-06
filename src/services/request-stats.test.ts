import { beforeEach, describe, expect, it } from 'vitest';
import { ERROR_RATE_THRESHOLD, MIN_SAMPLES, recordResponse, reset, snapshot, WINDOW_MS } from './request-stats.js';

describe('request-stats rolling window', () => {
  beforeEach(() => reset());

  it('starts empty and not degraded', () => {
    expect(snapshot(1_000)).toMatchObject({ total: 0, serverErrors: 0, serverErrorRate: 0, degraded: false });
  });

  it('computes the server-error rate over the window', () => {
    const t0 = 1_000_000;
    for (let i = 0; i < 7; i++) recordResponse(200, t0 + i);
    recordResponse(500, t0 + 10);
    recordResponse(502, t0 + 11);
    recordResponse(404, t0 + 12);
    const s = snapshot(t0 + 20);
    expect(s.total).toBe(10);
    expect(s.serverErrors).toBe(2);
    expect(s.clientErrors).toBe(1);
    expect(s.serverErrorRate).toBeCloseTo(0.2);
  });

  it('evicts samples older than WINDOW_MS', () => {
    const t0 = 1_000_000;
    recordResponse(500, t0);
    recordResponse(500, t0 + 1);
    recordResponse(200, t0 + WINDOW_MS + 5);
    const s = snapshot(t0 + WINDOW_MS + 10);
    expect(s.total).toBe(1);
    expect(s.serverErrors).toBe(0);
  });

  it('is degraded only with enough samples at or above the threshold', () => {
    const t0 = 5_000_000;
    // Too few samples: even 100% errors is not "degraded".
    for (let i = 0; i < MIN_SAMPLES - 1; i++) recordResponse(500, t0 + i);
    expect(snapshot(t0 + 100).degraded).toBe(false);
    // One more sample reaches MIN_SAMPLES with rate 1.0 >= threshold.
    recordResponse(500, t0 + 50);
    expect(snapshot(t0 + 100).degraded).toBe(true);
    // Dilute below the threshold.
    reset();
    const good = Math.ceil(MIN_SAMPLES / ERROR_RATE_THRESHOLD);
    for (let i = 0; i < good; i++) recordResponse(200, t0 + i);
    for (let i = 0; i < MIN_SAMPLES - 1; i++) recordResponse(500, t0 + 100 + i);
    expect(snapshot(t0 + 300).degraded).toBe(false);
  });
});
