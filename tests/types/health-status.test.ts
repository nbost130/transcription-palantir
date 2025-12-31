import { describe, it, expect } from 'vitest';
import { HealthStatus, isValidHealthStatus } from '../../src/types/health-status';

describe('HealthStatus', () => {
    it('should have correct values', () => {
        expect(HealthStatus.Healthy).toBe('Healthy');
        expect(HealthStatus.Stalled).toBe('Stalled');
        expect(HealthStatus.Recovered).toBe('Recovered');
        expect(HealthStatus.Unknown).toBe('Unknown');
    });

    describe('isValidHealthStatus', () => {
        it('should return true for valid status values', () => {
            expect(isValidHealthStatus('Healthy')).toBe(true);
            expect(isValidHealthStatus('Stalled')).toBe(true);
            expect(isValidHealthStatus('Recovered')).toBe(true);
            expect(isValidHealthStatus('Unknown')).toBe(true);
        });

        it('should return false for invalid status values', () => {
            expect(isValidHealthStatus('Invalid')).toBe(false);
            expect(isValidHealthStatus('')).toBe(false);
            expect(isValidHealthStatus('healthy')).toBe(false); // Case sensitive
        });
    });
});
