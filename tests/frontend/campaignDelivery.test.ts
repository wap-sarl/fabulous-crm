import { describe, expect, test } from 'bun:test';
import {
  abTestArgsOf,
  EMPTY_AB_TEST,
  scheduledAtOf,
} from '../../src/features/campaigns/lib/delivery';

const NOW = Date.UTC(2026, 9, 13, 10, 0, 0);

describe('the schedule of the composer', () => {
  test('nothing for a start at once, the instant on the organisation’s clock otherwise, refused in the past or unreadable', () => {
    expect(scheduledAtOf({ later: false, date: '', time: '' }, 'Europe/Paris', NOW)).toEqual({
      ok: true,
      value: undefined,
    });
    expect(
      scheduledAtOf({ later: true, date: '2026-10-14', time: '09:00' }, 'Europe/Paris', NOW),
    ).toEqual({ ok: true, value: Date.UTC(2026, 9, 14, 7, 0) });
    expect(
      scheduledAtOf({ later: true, date: '2026-10-13', time: '09:00' }, 'Europe/Paris', NOW).ok,
    ).toBe(false);
    expect(scheduledAtOf({ later: true, date: '', time: '09:00' }, 'Europe/Paris', NOW)).toEqual({
      ok: false,
      error: 'Indiquez la date et l’heure d’envoi.',
    });
  });
});

describe('the A/B test of the composer', () => {
  test('nothing when off; on, the variant B of its kind, trimmed, with its numbers read', () => {
    expect(abTestArgsOf(EMPTY_AB_TEST)).toEqual({ ok: true, value: undefined });
    expect(abTestArgsOf({ ...EMPTY_AB_TEST, enabled: true, subjectB: ' Objet B ' })).toEqual({
      ok: true,
      value: {
        kind: 'subject',
        subjectB: 'Objet B',
        htmlBodyB: undefined,
        splitPercent: 20,
        windowHours: 4,
        metric: 'opens',
      },
    });
    expect(
      abTestArgsOf({
        ...EMPTY_AB_TEST,
        enabled: true,
        kind: 'content',
        htmlBodyB: '<p>B</p>',
        splitPercent: '30',
        windowHours: '12',
        metric: 'clicks',
      }),
    ).toEqual({
      ok: true,
      value: {
        kind: 'content',
        subjectB: undefined,
        htmlBodyB: '<p>B</p>',
        splitPercent: 30,
        windowHours: 12,
        metric: 'clicks',
      },
    });
  });

  test('a missing variant B, an empty editor, or a number out of bounds stops the submit', () => {
    const on = { ...EMPTY_AB_TEST, enabled: true };
    expect(abTestArgsOf({ ...on, subjectB: '  ' }).ok).toBe(false);
    expect(abTestArgsOf({ ...on, kind: 'content', htmlBodyB: '<p></p>' }).ok).toBe(false);
    expect(abTestArgsOf({ ...on, subjectB: 'B', splitPercent: '5' })).toEqual({
      ok: false,
      error: 'La part testée va de 10 à 50 %.',
    });
    expect(abTestArgsOf({ ...on, subjectB: 'B', windowHours: '0' })).toEqual({
      ok: false,
      error: 'La fenêtre de test va de 1 à 72 heures.',
    });
    expect(abTestArgsOf({ ...on, subjectB: 'B', splitPercent: '12.5' }).ok).toBe(false);
  });
});
