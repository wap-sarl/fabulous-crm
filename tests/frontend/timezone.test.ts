import { describe, expect, test } from 'bun:test';
import { epochToZoned, formatInZone, timeZoneOptions, zonedToEpoch } from '../../src/lib/timezone';

describe('a wall clock in the organisation’s zone', () => {
  test('becomes the instant it names, summer and winter, and comes back as typed', () => {
    expect(zonedToEpoch('2026-07-01', '09:00', 'Europe/Paris')).toBe(Date.UTC(2026, 6, 1, 7, 0));
    expect(zonedToEpoch('2026-01-15', '09:00', 'Europe/Paris')).toBe(Date.UTC(2026, 0, 15, 8, 0));
    expect(zonedToEpoch('2026-01-15', '09:00', 'America/Montreal')).toBe(
      Date.UTC(2026, 0, 15, 14, 0),
    );
    expect(zonedToEpoch('2026-03-29', '03:30', 'Europe/Paris')).toBe(Date.UTC(2026, 2, 29, 1, 30));
    for (const [date, time] of [
      ['2026-07-01', '09:00'],
      ['2026-12-31', '23:59'],
      ['2026-10-25', '02:30'],
    ]) {
      const at = zonedToEpoch(date, time, 'Europe/Paris');
      expect(at).not.toBeNull();
      expect(epochToZoned(at!, 'Europe/Paris')).toEqual({ date, time });
    }
  });

  test('a date or a time that does not parse gives nothing', () => {
    expect(zonedToEpoch('', '09:00', 'Europe/Paris')).toBeNull();
    expect(zonedToEpoch('2026-07-01', '9h', 'Europe/Paris')).toBeNull();
    expect(zonedToEpoch('2026-13-01', '09:00', 'Europe/Paris')).toBeNull();
  });

  test('is written in the zone, and the zones offered hold the current one', () => {
    expect(formatInZone(Date.UTC(2026, 6, 1, 7, 0), 'Europe/Paris')).toBe('1 juil. 2026, 09:00');
    expect(formatInZone(Date.UTC(2026, 6, 1, 7, 0), 'Indian/Reunion')).toBe('1 juil. 2026, 11:00');
    const zones = timeZoneOptions('Europe/Paris');
    expect(zones).toContain('Europe/Paris');
    expect(zones).toContain('America/Toronto');
    expect(timeZoneOptions('Custom/Zone')[0]).toBe('Custom/Zone');
  });
});
