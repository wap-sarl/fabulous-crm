import { describe, expect, test } from 'bun:test';
import { buildSendSeries } from '../../src/features/campaigns/lib/sends';
import { shortDateFormat } from '../../src/lib/format';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const T0 = Date.UTC(2026, 9, 1, 9, 0, 0);
// The labels follow the zone of the machine: they are named as the chart names them.
const hourLabel = (at: number) =>
  new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' }).format(at);

describe('the chart of sends over time', () => {
  test('nothing sent draws nothing', () => {
    expect(buildSendSeries({})).toEqual([]);
  });

  test('within two days, one point per hour that saw a send, in order', () => {
    expect(
      buildSendSeries({ [String(T0 + 3 * HOUR)]: 5, [String(T0)]: 20, [String(T0 + DAY)]: 1 }),
    ).toEqual([
      { label: hourLabel(T0), value: 20 },
      { label: hourLabel(T0 + 3 * HOUR), value: 5 },
      { label: hourLabel(T0 + DAY), value: 1 },
    ]);
  });

  test('past two days, the hours of one day add up to one point', () => {
    expect(
      buildSendSeries({
        [String(T0)]: 20,
        [String(T0 + HOUR)]: 5,
        [String(T0 + 3 * DAY)]: 2,
      }),
    ).toEqual([
      { label: shortDateFormat.format(T0), value: 25 },
      { label: shortDateFormat.format(T0 + 3 * DAY), value: 2 },
    ]);
  });
});
