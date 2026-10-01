import { describe, expect, test } from 'bun:test';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { defaultTransitions, type PipelineStage } from '../../convex/_lib/validators/deals';
import { asIdentity, createTestConvex, seedEmployee, type T } from './helpers';

async function setup() {
  const t = createTestConvex();
  const emp = await seedEmployee(t, { email: 'ada@example.com', role: 'admin' });
  const as = asIdentity(t, emp.identity);
  return { t, emp, as };
}

const STAGES: PipelineStage[] = [
  { key: 'contact', label: 'Premier contact', kind: 'open' },
  { key: 'audit', label: 'Audit', kind: 'open' },
  { key: 'signed', label: 'Signé', kind: 'won' },
  { key: 'dropped', label: 'Abandonné', kind: 'lost' },
];

const pipelineOf = async (t: T, pipelineId: Id<'pipelines'>) =>
  (await t.run((ctx) => ctx.db.get(pipelineId)))!;

describe('pipeline creation', () => {
  test('the first pipeline is the default one, stored with trimmed name, labels and tags', async () => {
    const { t, as, emp } = await setup();
    const pipelineId = await as.mutation(api.features.deals.mutations.createPipeline, {
      name: '  Partenariats  ',
      stages: [
        // Requiring a tag means nothing on a stage without tags: both are dropped.
        { key: 'contact', label: ' Premier contact ', kind: 'open', tags: [], tagsRequired: true },
        { key: 'signed', label: 'Signé', kind: 'won' },
        {
          key: 'dropped',
          label: 'Abandonné',
          kind: 'lost',
          tags: [
            { key: 'price', label: ' Prix ' },
            { key: 'timing', label: 'Calendrier' },
          ],
          tagsRequired: true,
        },
      ],
    });

    const pipeline = await pipelineOf(t, pipelineId);
    expect(pipeline).toMatchObject({
      name: 'Partenariats',
      isDefault: true,
      createdBy: emp.userId,
      updatedBy: emp.userId,
    });
    expect(pipeline.stages).toEqual([
      { key: 'contact', label: 'Premier contact', kind: 'open' },
      { key: 'signed', label: 'Signé', kind: 'won' },
      {
        key: 'dropped',
        label: 'Abandonné',
        kind: 'lost',
        tags: [
          { key: 'price', label: 'Prix' },
          { key: 'timing', label: 'Calendrier' },
        ],
        tagsRequired: true,
      },
    ]);
    expect(pipeline.transitions).toBeUndefined();

    const listed = await as.query(api.features.deals.queries.listPipelines, {});
    expect(listed.map((p) => p._id)).toEqual([pipelineId]);
    const audit = await t.run((ctx) =>
      ctx.db
        .query('auditLogs')
        .withIndex('by_entity', (q) => q.eq('entityType', 'pipeline').eq('entityId', pipelineId))
        .collect(),
    );
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ action: 'create', userId: emp.userId });
  });

  test('a later pipeline is the default only when asked, and then takes it from the previous one', async () => {
    const { t, as } = await setup();
    const create = (name: string, isDefault?: boolean) =>
      as.mutation(api.features.deals.mutations.createPipeline, { name, stages: STAGES, isDefault });
    const first = await create('Ventes');
    const second = await create('Partenariats');
    expect((await pipelineOf(t, first)).isDefault).toBe(true);
    expect((await pipelineOf(t, second)).isDefault).toBeUndefined();

    // Declining the default on the first pipeline of an instance is ignored: there must be one.
    const third = await create('Renouvellements', true);
    expect((await pipelineOf(t, third)).isDefault).toBe(true);
    expect((await pipelineOf(t, first)).isDefault).toBeUndefined();
    expect((await pipelineOf(t, second)).isDefault).toBeUndefined();
  });

  test('a pipeline created once every other is deleted becomes the default', async () => {
    const { t, as } = await setup();
    const first = await as.mutation(api.features.deals.mutations.createPipeline, {
      name: 'Ventes',
      stages: STAGES,
    });
    await as.mutation(api.features.deals.mutations.deletePipeline, { pipelineId: first });

    const second = await as.mutation(api.features.deals.mutations.createPipeline, {
      name: 'Partenariats',
      stages: STAGES,
      isDefault: false,
    });
    expect((await pipelineOf(t, second)).isDefault).toBe(true);
  });

  test('the default graph is stored as absent, any other graph as given', async () => {
    const { t, as } = await setup();
    const standard = await as.mutation(api.features.deals.mutations.createPipeline, {
      name: 'Ventes',
      stages: STAGES,
      transitions: defaultTransitions(STAGES),
    });
    expect((await pipelineOf(t, standard)).transitions).toBeUndefined();

    const oneWay = [
      { from: 'contact', to: 'audit' },
      { from: 'audit', to: 'signed' },
      { from: 'audit', to: 'dropped' },
      { from: 'dropped', to: 'contact' },
    ];
    const custom = await as.mutation(api.features.deals.mutations.createPipeline, {
      name: 'Partenariats',
      stages: STAGES,
      transitions: oneWay,
    });
    expect((await pipelineOf(t, custom)).transitions).toEqual(oneWay);
  });

  test('a blank name, invalid stages or an invalid graph are refused, and nothing is created', async () => {
    const { t, as } = await setup();
    const create = (args: {
      name?: string;
      stages?: PipelineStage[];
      transitions?: { from: string; to: string }[];
    }) =>
      as.mutation(api.features.deals.mutations.createPipeline, {
        name: 'Ventes',
        stages: STAGES,
        ...args,
      });

    await expect(create({ name: '   ' })).rejects.toThrow('pipeline_name_required');
    await expect(create({ stages: [] })).rejects.toThrow('pipeline_no_stages');
    await expect(create({ stages: STAGES.filter((s) => s.kind !== 'won') })).rejects.toThrow(
      'pipeline_no_won_stage',
    );
    await expect(create({ stages: [...STAGES, STAGES[0]] })).rejects.toThrow(
      'pipeline_duplicate_key',
    );
    await expect(create({ transitions: [{ from: 'contact', to: 'unknown' }] })).rejects.toThrow(
      'pipeline_transition_unknown_stage',
    );
    await expect(create({ transitions: [{ from: 'signed', to: 'dropped' }] })).rejects.toThrow(
      'pipeline_transition_from_closed',
    );

    expect(await t.run((ctx) => ctx.db.query('pipelines').collect())).toEqual([]);
    expect(await t.run((ctx) => ctx.db.query('auditLogs').collect())).toEqual([]);
  });
});
