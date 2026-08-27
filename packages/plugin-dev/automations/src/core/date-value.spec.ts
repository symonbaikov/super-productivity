import { describe, it, expect } from 'vitest';
import { resolveDateValue } from './date-value';

// Pin the zone, otherwise the DST assertions below are vacuous on a UTC machine
// (which is what CI runs). Safe here because nothing constructs a Date at module
// scope — every Date in this file is built inside a test.
process.env.TZ = 'Europe/Berlin';

describe('resolveDateValue', () => {
  const at = (y: number, m: number, d: number, h = 12): Date => new Date(y, m - 1, d, h);

  describe('absolute values', () => {
    it('accepts a valid YYYY-MM-DD', () => {
      expect(resolveDateValue('2026-03-08', at(2026, 1, 1))).toBe('2026-03-08');
    });

    it('accepts a leap day', () => {
      expect(resolveDateValue('2028-02-29', at(2026, 1, 1))).toBe('2028-02-29');
    });

    it('rejects a date that does not exist', () => {
      expect(resolveDateValue('2026-02-30', at(2026, 1, 1))).toBeNull();
      expect(resolveDateValue('2026-13-01', at(2026, 1, 1))).toBeNull();
    });
  });

  describe('relative values', () => {
    it('adds days', () => {
      expect(resolveDateValue('+3d', at(2026, 8, 28))).toBe('2026-08-31');
      expect(resolveDateValue('3 days', at(2026, 8, 28))).toBe('2026-08-31');
      expect(resolveDateValue('+0d', at(2026, 8, 28))).toBe('2026-08-28');
    });

    it('adds weeks', () => {
      expect(resolveDateValue('+2w', at(2026, 8, 28))).toBe('2026-09-11');
      expect(resolveDateValue('+1week', at(2026, 12, 28))).toBe('2027-01-04');
    });

    it('adds months and clamps to the end of the target month', () => {
      expect(resolveDateValue('+1m', at(2026, 1, 15))).toBe('2026-02-15');
      expect(resolveDateValue('+1m', at(2026, 1, 31))).toBe('2026-02-28');
      expect(resolveDateValue('+1month', at(2028, 1, 31))).toBe('2028-02-29');
      expect(resolveDateValue('+13m', at(2026, 1, 15))).toBe('2027-02-15');
    });

    it('adds years and clamps a leap day', () => {
      expect(resolveDateValue('+1y', at(2026, 8, 28))).toBe('2027-08-28');
      expect(resolveDateValue('+1y', at(2028, 2, 29))).toBe('2029-02-28');
    });

    it('supports negative offsets', () => {
      expect(resolveDateValue('-1d', at(2026, 1, 1))).toBe('2025-12-31');
      expect(resolveDateValue('-1m', at(2026, 3, 31))).toBe('2026-02-28');
    });

    it('does not drift across a DST transition', () => {
      // Europe/Berlin springs forward on 2026-03-29 and falls back on 2026-10-25.
      // Calendar arithmetic must land on the same day-of-month either way, which
      // naive `+ n * 24h` millisecond math would get wrong.
      // Guard: prove the window really straddles a transition, so a zone change
      // turns this into a failure rather than a silently vacuous test.
      expect(at(2026, 3, 28).getTimezoneOffset()).not.toBe(at(2026, 3, 30).getTimezoneOffset());
      expect(at(2026, 10, 24).getTimezoneOffset()).not.toBe(at(2026, 10, 26).getTimezoneOffset());
      expect(resolveDateValue('+1d', at(2026, 3, 28))).toBe('2026-03-29');
      expect(resolveDateValue('+2d', at(2026, 3, 28))).toBe('2026-03-30');
      expect(resolveDateValue('+1d', at(2026, 10, 24))).toBe('2026-10-25');
      expect(resolveDateValue('+2d', at(2026, 10, 24))).toBe('2026-10-26');
    });

    it('stays on the same day when resolved just before midnight', () => {
      expect(resolveDateValue('+1d', at(2026, 8, 28, 23))).toBe('2026-08-29');
      expect(resolveDateValue('+0d', at(2026, 8, 28, 23))).toBe('2026-08-28');
    });
  });

  describe('invalid values', () => {
    it('returns null', () => {
      for (const value of ['', 'tomorrow', '+d', '3', '28.08.2026', '+1x', '+99999d']) {
        expect(resolveDateValue(value, at(2026, 8, 28))).toBeNull();
      }
    });
  });
});
