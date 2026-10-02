import { describe, expect, test } from 'bun:test';
import { api } from '../../convex/_generated/api';
import {
  countSchema,
  dayDateSchema,
  follows,
  nonNegativeSchema,
  positiveIntSchema,
} from '../../convex/_lib/validators/fields';
import { IMPORT_MAX_ROWS } from '../../convex/_lib/validators/imports';
import { DEFAULT_LIFECYCLE_STAGES } from '../../convex/_lib/validators/lifecycle';
import {
  decayHalfLifeSchema,
  leadScoreSchema,
  scoringPointsSchema,
} from '../../convex/_lib/validators/scoring';
import { asIdentity, createTestConvex, seedConfig, seedEmployee, seedLead } from './helpers';

async function setup() {
  const t = createTestConvex();
  const emp = await seedEmployee(t, { email: 'admin@example.com', role: 'admin' });
  await seedConfig(t);
  return { t, as: asIdentity(t, emp.identity) };
}

const code = (c: string, reason?: string) => ({ data: reason ? { code: c, reason } : { code: c } });

describe('the numbers the backend accepts, at their bounds', () => {
  test.each([
    ['a score', leadScoreSchema, [0, 1, 100], [-1, 101, 1.5, Number.NaN]],
    ['the points of a rule', scoringPointsSchema, [-100, -1, 1, 100], [0, 101, -101, 1.5]],
    [
      'a half-life',
      decayHalfLifeSchema,
      [0.5, 1, 365],
      [0, -1, 365.5, 366, Number.POSITIVE_INFINITY],
    ],
    ['a whole number from 1', positiveIntSchema, [1, 2, 10_000], [0, -1, 1.5, Number.NaN]],
    ['a count', countSchema, [0, 1, 250], [-1, 0.5, Number.NaN]],
    [
      'a quantity that is not negative',
      nonNegativeSchema,
      [0, 0.5, 1200],
      [-0.01, -1, Number.NaN, Number.POSITIVE_INFINITY],
    ],
    [
      'a day',
      dayDateSchema,
      ['2027-01-31', '1999-12-01'],
      ['2027-1-31', '31/01/2027', '2027-01-31T10:00', ' 2027-01-31', '', 'x2027-01-31'],
    ],
  ] as const)('%s', (_name, schema, accepted, refused) => {
    for (const value of accepted) expect(follows(schema, value)).toBe(true);
    for (const value of refused) expect(follows(schema, value)).toBe(false);
    expect(follows(schema, undefined)).toBe(false);
  });

  test('a scoring rule: points and half-life, when it is created and when it is changed', async () => {
    const { as } = await setup();
    const write = api.features.scoring.mutations;
    const criteria = {
      combinator: 'and' as const,
      groups: [
        {
          combinator: 'and' as const,
          rules: [
            {
              field: { kind: 'standard' as const, field: 'ownerIds' as const },
              operator: 'isEmpty' as const,
            },
          ],
        },
      ],
    };
    const create = (points: number, decayHalfLifeDays?: number) =>
      as.mutation(write.createScoringRule, {
        name: 'Sans propriétaire',
        criteria,
        points,
        active: false,
        decayHalfLifeDays,
      });
    for (const points of [0, 101, -101, 1.5]) {
      await expect(create(points)).rejects.toMatchObject(code('invalid_scoring_points'));
    }
    for (const days of [0, -1, 365.5, 366]) {
      await expect(create(10, days)).rejects.toMatchObject(code('invalid_scoring_decay'));
    }
    const ruleId = await create(100, 365);
    await create(-100, 0.5);
    for (const points of [0, 101, -101, 1.5]) {
      await expect(as.mutation(write.updateScoringRule, { ruleId, points })).rejects.toMatchObject(
        code('invalid_scoring_points'),
      );
    }
    for (const decayHalfLifeDays of [0, 366]) {
      await expect(
        as.mutation(write.updateScoringRule, { ruleId, decayHalfLifeDays }),
      ).rejects.toMatchObject(code('invalid_scoring_decay'));
    }
    await as.mutation(write.updateScoringRule, { ruleId, points: -1, decayHalfLifeDays: null });
  });

  test('a simulation threshold and a promotion score are scores', async () => {
    const { as } = await setup();
    const simulate = (threshold: number) =>
      as.mutation(api.features.scoring.mutations.startScoreSimulation, { threshold });
    for (const threshold of [-1, 101, 1.5]) {
      await expect(simulate(threshold)).rejects.toMatchObject(code('invalid_scoring_threshold'));
    }
    await simulate(0);
    await simulate(100);

    const promote = (minScore: number) =>
      as.mutation(api.features.config.mutations.updateLifecycleConfig, {
        stages: [...DEFAULT_LIFECYCLE_STAGES],
        defaultStage: 'lead',
        allowRegression: false,
        scorePromotion: { stage: 'mql', minScore },
      });
    for (const minScore of [-1, 101, 1.5]) {
      await expect(promote(minScore)).rejects.toMatchObject(
        code('lifecycle_invalid_promotion_score'),
      );
    }
    await promote(0);
    await promote(100);
  });

  test('an import has at least one row, a whole number of them, and no more than the cap', async () => {
    const { as } = await setup();
    const open = (totalRows: number) =>
      as.mutation(api.features.imports.mutations.createJob, {
        entity: 'lead',
        fileName: 'fichier.csv',
        headers: ['a'],
        targets: [null],
        totalRows,
      });
    for (const totalRows of [0, -1, 1.5]) {
      await expect(open(totalRows)).rejects.toMatchObject(code('import_empty'));
    }
    await expect(open(IMPORT_MAX_ROWS + 1)).rejects.toMatchObject(code('import_too_large'));
    await open(1);
    await open(IMPORT_MAX_ROWS);
  });

  test('a file has a size that is not negative; an empty file is a file', async () => {
    const { t, as } = await setup();
    const leadId = await seedLead(t, {});
    const url = (size: number) =>
      as.mutation(api.features.attachments.mutations.generateAttachmentUploadUrl, {
        entityType: 'lead',
        entityId: leadId,
        size,
      });
    await expect(url(-1)).rejects.toMatchObject(code('invalid_file_size'));
    expect((await url(0)).uploadUrl).toBeString();
  });

  test('a deal: an amount that is not negative, a closing day written as a day', async () => {
    const { as } = await setup();
    await as.mutation(api.features.deals.mutations.ensureDefaultPipeline, {});
    const create = (fields: { amount?: number; expectedCloseDate?: string }) =>
      as.mutation(api.features.deals.mutations.createDeal, { title: 'Contrat', ...fields });
    await expect(create({ amount: -0.01 })).rejects.toMatchObject(code('invalid_deal', 'amount'));
    for (const expectedCloseDate of ['2027-1-31', '31/01/2027', '2027-01-31T10:00']) {
      await expect(create({ expectedCloseDate })).rejects.toMatchObject(
        code('invalid_deal', 'expectedCloseDate'),
      );
    }
    const dealId = await create({ amount: 0, expectedCloseDate: '2027-01-31' });
    await expect(
      as.mutation(api.features.deals.mutations.updateDeal, { dealId, amount: -1 }),
    ).rejects.toMatchObject(code('invalid_deal', 'amount'));
    await expect(
      as.mutation(api.features.deals.mutations.updateDeal, { dealId, expectedCloseDate: 'demain' }),
    ).rejects.toMatchObject(code('invalid_deal', 'expectedCloseDate'));
  });
});
