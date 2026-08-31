import { describe, expect, test } from 'bun:test';
import type { Doc } from '../../convex/_generated/dataModel';
import type {
  LeadAdvancedFilter,
  FilterField,
  FilterRule,
  LeadStandardField,
} from '../../convex/_lib/validators/filters';
import { evalAdvancedFilter, evalRule } from '../../convex/features/crm/leadMatching';

/**
 * Exhaustive coverage of the pure advanced-filter evaluator — the engine the
 * plan builds dynamic lists (#23) and lead scoring (#25) on. Every operator is
 * exercised against every kind of stored value it can meet: standard string
 * columns, the status, booleans, the marketingConsent array, and custom
 * properties (text, number, checkbox array).
 */

const DEF_TEXT = 'def_text';
const DEF_NUM = 'def_num';
const DEF_CHECK = 'def_check';

function lead(overrides: Partial<Doc<'leads'>> = {}): Doc<'leads'> {
  return {
    _id: 'lead1',
    _creationTime: 0,
    firstName: 'Marie',
    lastName: 'Curie',
    email: 'marie.curie@example.com',
    phone: '+33612345678',
    comment: 'Physicienne',
    lifecycleStage: 'lead',
    ownerIds: [],
    isRedFlagged: false,
    marketingConsent: ['email'],
    consentToken: 'tok',
    updatedAt: 0,
    customProperties: {
      [DEF_TEXT]: 'Radiologie',
      [DEF_NUM]: 42,
      [DEF_CHECK]: ['opt_a', 'opt_b'],
    },
    ...overrides,
  } as Doc<'leads'>;
}

const std = (field: LeadStandardField): FilterField => ({ kind: 'standard', field });
const custom = (definitionId: string): FilterField => ({ kind: 'custom', definitionId });

const rule = (field: FilterField, operator: FilterRule['operator'], value?: FilterRule['value']) =>
  ({ field, operator, value }) as FilterRule;

const single = (r: FilterRule): LeadAdvancedFilter => ({
  combinator: 'and',
  groups: [{ combinator: 'and', rules: [r] }],
});

describe('equals', () => {
  test.each([
    ['string match', std('firstName'), 'Marie', true],
    ['string mismatch', std('firstName'), 'Pierre', false],
    ['status match', std('lifecycleStage'), 'lead', true],
    ['status mismatch', std('lifecycleStage'), 'customer', false],
    ['custom text match', custom(DEF_TEXT), 'Radiologie', true],
    ['custom number match', custom(DEF_NUM), 42, true],
    ['custom number mismatch', custom(DEF_NUM), 43, false],
  ] as const)('%s', (_name, field, value, expected) => {
    expect(evalRule(lead(), rule(field, 'equals', value))).toBe(expected);
  });

  test('boolean: isRedFlagged true only matches a flagged lead', () => {
    const r = rule(std('isRedFlagged'), 'equals', true);
    expect(evalRule(lead({ isRedFlagged: true }), r)).toBe(true);
    // false counts as a *set* value (not empty) but does not equal true.
    expect(evalRule(lead({ isRedFlagged: false }), r)).toBe(false);
  });

  test('"is one of": an array value matches any listed option', () => {
    const r = rule(std('lifecycleStage'), 'equals', ['mql', 'sql']);
    expect(evalRule(lead({ lifecycleStage: 'mql' }), r)).toBe(true);
    expect(evalRule(lead({ lifecycleStage: 'lead' }), r)).toBe(false);
  });

  test('array stored (checkbox / consent): equals means intersection', () => {
    expect(evalRule(lead(), rule(custom(DEF_CHECK), 'equals', ['opt_b']))).toBe(true);
    expect(evalRule(lead(), rule(custom(DEF_CHECK), 'equals', ['opt_z']))).toBe(false);
    expect(evalRule(lead(), rule(std('marketingConsent'), 'equals', ['email']))).toBe(true);
  });

  test('a range value never satisfies equals', () => {
    expect(evalRule(lead(), rule(custom(DEF_NUM), 'equals', { min: 0, max: 100 }))).toBe(false);
  });
});

describe('contains', () => {
  test('substring match is case-insensitive', () => {
    expect(evalRule(lead(), rule(std('email'), 'contains', 'CURIE'))).toBe(true);
    expect(evalRule(lead(), rule(std('email'), 'contains', 'einstein'))).toBe(false);
  });

  test('array stored: membership of any wanted option', () => {
    expect(evalRule(lead(), rule(std('marketingConsent'), 'contains', ['email', 'sms']))).toBe(
      true,
    );
    expect(
      evalRule(
        lead({ marketingConsent: [] }),
        rule(std('marketingConsent'), 'contains', ['email']),
      ),
    ).toBe(false);
  });

  test('non-string scalar stored never contains', () => {
    expect(evalRule(lead(), rule(custom(DEF_NUM), 'contains', '4'))).toBe(false);
  });
});

describe('isEmpty / isNotEmpty', () => {
  test.each([
    ['undefined is empty', lead({ phone: undefined }), std('phone'), true],
    ['empty string is empty', lead({ phone: '' }), std('phone'), true],
    ['empty array is empty', lead({ marketingConsent: [] }), std('marketingConsent'), true],
    ['set string is not empty', lead(), std('phone'), false],
    ['false is NOT empty', lead({ isRedFlagged: false }), std('isRedFlagged'), false],
    ['0 is NOT empty', lead({ customProperties: { [DEF_NUM]: 0 } }), custom(DEF_NUM), false],
    ['missing custom prop is empty', lead({ customProperties: {} }), custom(DEF_TEXT), true],
  ])('%s', (_name, l, field, expected) => {
    expect(evalRule(l, rule(field, 'isEmpty'))).toBe(expected);
    expect(evalRule(l, rule(field, 'isNotEmpty'))).toBe(!expected);
  });
});

describe('gt / lt / between', () => {
  test('numbers compare numerically', () => {
    expect(evalRule(lead(), rule(custom(DEF_NUM), 'gt', 41))).toBe(true);
    expect(evalRule(lead(), rule(custom(DEF_NUM), 'gt', 42))).toBe(false);
    expect(evalRule(lead(), rule(custom(DEF_NUM), 'lt', 43))).toBe(true);
    expect(evalRule(lead(), rule(custom(DEF_NUM), 'lt', 42))).toBe(false);
  });

  test('ISO date strings compare lexicographically (correct chronological order)', () => {
    const l = lead({ customProperties: { [DEF_TEXT]: '2026-03-15' } });
    expect(evalRule(l, rule(custom(DEF_TEXT), 'gt', '2026-01-01'))).toBe(true);
    expect(evalRule(l, rule(custom(DEF_TEXT), 'lt', '2026-01-01'))).toBe(false);
  });

  test('between honors min-only, max-only, both bounds, inclusive', () => {
    const at = (v: number, range: { min?: number; max?: number }) =>
      evalRule(
        lead({ customProperties: { [DEF_NUM]: v } }),
        rule(custom(DEF_NUM), 'between', range),
      );
    expect(at(42, { min: 42 })).toBe(true);
    expect(at(41, { min: 42 })).toBe(false);
    expect(at(42, { max: 42 })).toBe(true);
    expect(at(43, { max: 42 })).toBe(false);
    expect(at(42, { min: 40, max: 45 })).toBe(true);
    expect(at(39, { min: 40, max: 45 })).toBe(false);
  });

  test('configured but incomparable values fail closed', () => {
    // Booleans have no ordering: the rule must exclude, never match by accident.
    expect(evalRule(lead({ isRedFlagged: true }), rule(std('isRedFlagged'), 'gt', 0))).toBe(false);
    // A number column against a non-date string is not a comparison.
    expect(evalRule(lead(), rule(custom(DEF_NUM), 'gt', 'abc'))).toBe(false);
    // A timestamp against a non-date string neither.
    expect(
      evalRule(lead({ lastEmailOpenAt: 1000 }), rule(std('lastEmailOpenAt'), 'gt', '42')),
    ).toBe(false);
    // A between value that isn't a range is malformed.
    expect(evalRule(lead(), rule(custom(DEF_NUM), 'between', 10))).toBe(false);
    expect(
      evalRule(
        lead({ lastEmailOpenAt: 1000 }),
        rule(std('lastEmailOpenAt'), 'between', { min: 'abc' }),
      ),
    ).toBe(false);
  });
});

describe('notEquals', () => {
  test('inverts equals, and an absent value counts as different', () => {
    expect(evalRule(lead(), rule(std('lifecycleStage'), 'notEquals', ['mql']))).toBe(true);
    expect(evalRule(lead(), rule(std('lifecycleStage'), 'notEquals', ['lead']))).toBe(false);
    expect(evalRule(lead(), rule(std('lifecycleStage'), 'notEquals', ['lead', 'mql']))).toBe(false);
    // No status at all ⇒ « différent de MQL » holds.
    expect(
      evalRule(
        lead({ lifecycleStage: undefined }),
        rule(std('lifecycleStage'), 'notEquals', ['mql']),
      ),
    ).toBe(true);
  });
});

describe('relative date operators', () => {
  const NOW = Date.UTC(2026, 7, 31, 12);
  const DAY = 24 * 60 * 60 * 1000;
  const at = (l: Doc<'leads'>, r: FilterRule) => evalRule(l, r, { now: NOW });

  test('epoch-ms timestamps: in the last N days / more than N days ago', () => {
    const l = lead({ lastEmailOpenAt: NOW - 10 * DAY });
    expect(at(l, rule(std('lastEmailOpenAt'), 'inLastDays', 30))).toBe(true);
    expect(at(l, rule(std('lastEmailOpenAt'), 'inLastDays', 5))).toBe(false);
    expect(at(l, rule(std('lastEmailOpenAt'), 'moreThanDaysAgo', 5))).toBe(true);
    expect(at(l, rule(std('lastEmailOpenAt'), 'moreThanDaysAgo', 30))).toBe(false);
    // Never opened: no relative window can match.
    const never = lead({ lastEmailOpenAt: undefined });
    expect(at(never, rule(std('lastEmailOpenAt'), 'inLastDays', 30))).toBe(false);
    expect(at(never, rule(std('lastEmailOpenAt'), 'moreThanDaysAgo', 5))).toBe(false);
  });

  test('invalid stored values or day counts fail closed', () => {
    expect(at(lead({ isRedFlagged: true }), rule(std('isRedFlagged'), 'inLastDays', 30))).toBe(
      false,
    );
    const opened = lead({ lastEmailOpenAt: NOW - DAY });
    expect(at(opened, rule(std('lastEmailOpenAt'), 'inLastDays', 'abc'))).toBe(false);
    expect(at(opened, rule(std('lastEmailOpenAt'), 'moreThanDaysAgo', 'abc'))).toBe(false);
  });

  test('createdAt reads _creationTime', () => {
    const l = { ...lead(), _creationTime: NOW - 100 * DAY } as Doc<'leads'>;
    expect(at(l, rule(std('createdAt'), 'moreThanDaysAgo', 90))).toBe(true);
    expect(at(l, rule(std('createdAt'), 'inLastDays', 90))).toBe(false);
  });

  test('ISO date strings (custom props) parse for relative and mixed comparisons', () => {
    const past = lead({ customProperties: { [DEF_TEXT]: '2026-08-21' } });
    expect(at(past, rule(custom(DEF_TEXT), 'inLastDays', 30))).toBe(true);
    expect(at(past, rule(custom(DEF_TEXT), 'moreThanDaysAgo', 30))).toBe(false);
    const future = lead({ customProperties: { [DEF_TEXT]: '2026-09-05' } });
    expect(at(future, rule(custom(DEF_TEXT), 'inNextDays', 10))).toBe(true);
    expect(at(future, rule(custom(DEF_TEXT), 'inNextDays', 2))).toBe(false);
    expect(at(future, rule(custom(DEF_TEXT), 'inLastDays', 30))).toBe(false);
  });

  test('a timestamp column orders against an ISO date input (gt/lt/between)', () => {
    const l = lead({ lastEmailOpenAt: Date.UTC(2026, 7, 20) });
    expect(evalRule(l, rule(std('lastEmailOpenAt'), 'gt', '2026-08-01'))).toBe(true);
    expect(evalRule(l, rule(std('lastEmailOpenAt'), 'lt', '2026-08-01'))).toBe(false);
    expect(
      evalRule(
        l,
        rule(std('lastEmailOpenAt'), 'between', { min: '2026-08-01', max: '2026-08-31' }),
      ),
    ).toBe(true);
    expect(
      evalRule(
        l,
        rule(std('lastEmailOpenAt'), 'between', { min: '2026-08-21', max: '2026-08-31' }),
      ),
    ).toBe(false);
  });

  test('a date-only bound covers its whole day against a timestamp column', () => {
    // Opened at 15:00 on the range's last day: still inside the range.
    const afternoon = lead({ lastEmailOpenAt: Date.UTC(2026, 7, 31, 15) });
    const between = (min: string, max: string) =>
      evalRule(afternoon, rule(std('lastEmailOpenAt'), 'between', { min, max }));
    expect(between('2026-08-01', '2026-08-31')).toBe(true);
    expect(between('2026-08-31', '2026-08-31')).toBe(true);
    expect(between('2026-08-01', '2026-08-30')).toBe(false);
    // « après le 31/08 » excludes the whole day, « avant » stops at its start…
    expect(evalRule(afternoon, rule(std('lastEmailOpenAt'), 'gt', '2026-08-31'))).toBe(false);
    expect(evalRule(afternoon, rule(std('lastEmailOpenAt'), 'lt', '2026-08-31'))).toBe(false);
    expect(evalRule(afternoon, rule(std('lastEmailOpenAt'), 'gt', '2026-08-30'))).toBe(true);
    // …while an explicit datetime bound stays exact.
    expect(evalRule(afternoon, rule(std('lastEmailOpenAt'), 'gt', '2026-08-31T14:00Z'))).toBe(true);
  });
});

describe('behavioural counts and list membership', () => {
  test('counters default to 0 when the lead never got the signal', () => {
    expect(evalRule(lead(), rule(std('emailOpenCount'), 'equals', 0))).toBe(true);
    expect(evalRule(lead(), rule(std('emailOpenCount'), 'gt', 0))).toBe(false);
    expect(evalRule(lead({ emailOpenCount: 3 }), rule(std('emailOpenCount'), 'gt', 2))).toBe(true);
  });

  test('listIds evaluates against the resolved membership extras', () => {
    const member = { memberListIds: ['listA'] };
    const outsider = { memberListIds: [] as string[] };
    const isIn = rule(std('listIds'), 'equals', ['listA']);
    const isNotIn = rule(std('listIds'), 'notEquals', ['listA']);
    expect(evalRule(lead(), isIn, member)).toBe(true);
    expect(evalRule(lead(), isIn, outsider)).toBe(false);
    expect(evalRule(lead(), isNotIn, member)).toBe(false);
    expect(evalRule(lead(), isNotIn, outsider)).toBe(true);
    // No extras at all behaves like « member of nothing ».
    expect(evalRule(lead(), isIn)).toBe(false);
    expect(evalRule(lead(), isNotIn)).toBe(true);
  });
});

describe('empty stored values and inactive rules', () => {
  test('every operator except isEmpty fails on an absent value', () => {
    const l = lead({ phone: undefined });
    for (const op of ['equals', 'contains', 'gt', 'lt', 'between'] as const) {
      expect(evalRule(l, rule(std('phone'), op, op === 'between' ? { min: 0 } : 'x'))).toBe(false);
    }
  });

  test('rules with no value are inactive: they hide no rows', () => {
    const filter = single(rule(std('firstName'), 'equals', ''));
    expect(evalAdvancedFilter(lead(), filter)).toBe(true); // neutral ⇒ match
  });

  test('a between rule with neither bound is inactive', () => {
    expect(evalAdvancedFilter(lead(), single(rule(custom(DEF_NUM), 'between', {})))).toBe(true);
  });
});

describe('the two-level boolean tree', () => {
  const matchRule = rule(std('firstName'), 'equals', 'Marie');
  const missRule = rule(std('firstName'), 'equals', 'Pierre');

  test('group AND requires every rule; group OR requires one', () => {
    const and: LeadAdvancedFilter = {
      combinator: 'and',
      groups: [{ combinator: 'and', rules: [matchRule, missRule] }],
    };
    const or: LeadAdvancedFilter = {
      combinator: 'and',
      groups: [{ combinator: 'or', rules: [matchRule, missRule] }],
    };
    expect(evalAdvancedFilter(lead(), and)).toBe(false);
    expect(evalAdvancedFilter(lead(), or)).toBe(true);
  });

  test('top-level AND requires every group; top-level OR requires one', () => {
    const groups = [
      { combinator: 'and' as const, rules: [matchRule] },
      { combinator: 'and' as const, rules: [missRule] },
    ];
    expect(evalAdvancedFilter(lead(), { combinator: 'and', groups })).toBe(false);
    expect(evalAdvancedFilter(lead(), { combinator: 'or', groups })).toBe(true);
  });

  test('groups holding only inactive rules are neutral, not failing', () => {
    const filter: LeadAdvancedFilter = {
      combinator: 'and',
      groups: [
        { combinator: 'and', rules: [rule(std('lastName'), 'equals', '')] }, // inactive
        { combinator: 'and', rules: [matchRule] },
      ],
    };
    expect(evalAdvancedFilter(lead(), filter)).toBe(true);
  });

  test('an entirely empty filter matches everything', () => {
    expect(evalAdvancedFilter(lead(), { combinator: 'and', groups: [] })).toBe(true);
    expect(
      evalAdvancedFilter(lead(), { combinator: 'or', groups: [{ combinator: 'or', rules: [] }] }),
    ).toBe(true);
  });
});
