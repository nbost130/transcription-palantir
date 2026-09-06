import { describe, expect, it } from 'vitest';
import { isProbeUrl } from './logger.js';

describe('isProbeUrl', () => {
  it('matches health and readiness probes, with or without a query string', () => {
    expect(isProbeUrl('/api/v1/health')).toBe(true);
    expect(isProbeUrl('/api/v1/ready')).toBe(true);
    expect(isProbeUrl('/api/v1/ready?x=1')).toBe(true);
  });

  it('does not match real API traffic', () => {
    expect(isProbeUrl('/api/v1/jobs')).toBe(false);
    expect(isProbeUrl('/api/v1/jobs?limit=1')).toBe(false);
    expect(isProbeUrl('/api/v1/healthy-jobs')).toBe(false);
    expect(isProbeUrl('/')).toBe(false);
  });
});
