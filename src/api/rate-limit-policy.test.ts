import { describe, expect, it } from 'vitest';
import { isTrustedAddress } from './rate-limit-policy.js';

describe('isTrustedAddress', () => {
  describe('allowed', () => {
    it('allows IPv4 loopback', () => {
      expect(isTrustedAddress('127.0.0.1')).toBe(true);
    });

    it('allows any 127.x.x.x loopback address', () => {
      expect(isTrustedAddress('127.5.5.5')).toBe(true);
    });

    it('allows IPv6 loopback', () => {
      expect(isTrustedAddress('::1')).toBe(true);
    });

    it('allows IPv4-mapped IPv6 loopback', () => {
      expect(isTrustedAddress('::ffff:127.0.0.1')).toBe(true);
    });

    it('allows RFC1918 10/8', () => {
      expect(isTrustedAddress('10.1.2.3')).toBe(true);
    });

    it('allows RFC1918 172.16/12 at both edges', () => {
      expect(isTrustedAddress('172.16.0.1')).toBe(true);
      expect(isTrustedAddress('172.31.255.255')).toBe(true);
    });

    it('rejects 172.32.x.x (just outside the 172.16/12 block)', () => {
      expect(isTrustedAddress('172.32.0.1')).toBe(false);
    });

    it('allows RFC1918 192.168/16', () => {
      expect(isTrustedAddress('192.168.1.1')).toBe(true);
    });

    it('allows CGNAT 100.64.0.0/10 (Tailscale)', () => {
      expect(isTrustedAddress('100.64.0.1')).toBe(true);
      expect(isTrustedAddress('100.100.50.1')).toBe(true);
      expect(isTrustedAddress('100.127.255.255')).toBe(true);
    });

    it('rejects 100.128.x.x (just outside the CGNAT block)', () => {
      expect(isTrustedAddress('100.128.0.1')).toBe(false);
    });

    it('allows IPv6 unique local addresses (fc00::/7)', () => {
      expect(isTrustedAddress('fc00::1')).toBe(true);
      expect(isTrustedAddress('fd12:3456:789a::1')).toBe(true);
    });
  });

  describe('denied', () => {
    it('rejects a public IPv4 address (TEST-NET-3)', () => {
      expect(isTrustedAddress('203.0.113.9')).toBe(false);
    });

    it('rejects a well-known public DNS address', () => {
      expect(isTrustedAddress('8.8.8.8')).toBe(false);
    });

    it('rejects a public IPv6 documentation address', () => {
      expect(isTrustedAddress('2001:db8::1')).toBe(false);
    });

    it('rejects garbage input without throwing', () => {
      expect(isTrustedAddress('not-an-ip')).toBe(false);
      expect(isTrustedAddress('')).toBe(false);
      expect(isTrustedAddress('999.999.999.999')).toBe(false);
      expect(isTrustedAddress('...')).toBe(false);
    });
  });
});
