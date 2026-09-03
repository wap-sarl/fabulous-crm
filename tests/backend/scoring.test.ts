import { beforeAll, describe, expect, setSystemTime, test } from 'bun:test';
import { api, internal } from '../../convex/_generated/api';
import type { Doc, Id } from '../../convex/_generated/dataModel';
import type { LeadAdvancedFilter } from '../../convex/_lib/validators/filters';
import { DEFAULT_LIFECYCLE_STAGES } from '../../convex/_lib/validators/lifecycle';
import { computeLeadScore } from '../../convex/lib/leadScoring';
import { asIdentity, createTestConvex, seedEmployee, type T } from './helpers';

const DAY = 24 * 60 * 60 * 1000;

beforeAll(() => {
  // createCampaign refuses to run without a configured e-mail provider.
  process.env.BREVO_API_KEY = 'test-brevo-key';
});

async function setup() {
  const t = createTestConvex();
  const emp = await seedEmployee(t, { email: 'agent@example.com', role: 'admin' });
  const as = asIdentity(t, emp.identity);
  await t.run((ctx) =>
    ctx.db.insert('appConfig', {
      organizationName: 'WAP',
      appUrl: 'http://localhost:4202',
      senderEmail: 'crm@example.com',
      senderName: 'CRM',
      auth: { magicLinkEnabled: true },
      updatedAt: Date.now(),
    }),
  );
  return { t, emp, as };
}

const oneRule = (
  rule: LeadAdvancedFilter['groups'][number]['rules'][number],
): LeadAdvancedFilter => ({
  combinator: 'and',
  groups: [{ combinator: 'and', rules: [rule] }],
});

const stageIs = (stage: string) =>
  oneRule({
    field: { kind: 'standard', field: 'lifecycleStage' },
    operator: 'equals',
    value: [stage],
  });
const noOwner = () =>
  oneRule({ field: { kind: 'standard', field: 'ownerIds' }, operator: 'isEmpty' });
const emailContains = (needle: string) =>
  oneRule({ field: { kind: 'standard', field: 'email' }, operator: 'contains', value: needle });
const activeInLastDays = (days: number) =>
  oneRule({
    field: { kind: 'standard', field: 'lastActivityAt' },
    operator: 'inLastDays',
    value: days,
  });
const openedInLastDays = (days: number) =>
  oneRule({
    field: { kind: 'standard', field: 'lastEmailOpenAt' },
    operator: 'inLastDays',
    value: days,
  });

type As = ReturnType<typeof asIdentity>;

function createRule(
  as: As,
  name: string,
  criteria: LeadAdvancedFilter,
  points: number,
  extra?: { decayHalfLifeDays?: number; active?: boolean },
) {
  return as.mutation(api.features.scoring.mutations.createScoringRule, {
    name,
    criteria,
    points,
    active: extra?.active ?? true,
    decayHalfLifeDays: extra?.decayHalfLifeDays,
  });
}

/** Wait for the scheduled full-recomputation chain (runAfter(0) pages) to finish. */
async function settleScoring(t: T) {
  for (let i = 0; i < 100; i++) {
    const state = await t.run((ctx) => ctx.db.query('scoringState').first());
    if (state?.recalc === undefined) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('score recompute did not settle');
}

async function settleSimulation(t: T) {
  for (let i = 0; i < 100; i++) {
    const state = await t.run((ctx) => ctx.db.query('scoringState').first());
    if (state?.simulation?.finishedAt !== undefined) return state.simulation;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('score simulation did not settle');
}

const leadDoc = (t: T, leadId: Id<'leads'>) => t.run((ctx) => ctx.db.get(leadId));

describe('lead scoring', () => {
  test('points add up, negatives subtract, and the score clamps to 0–100', async () => {
    const { t, emp, as } = await setup();
    const r1 = await createRule(as, 'MQL', stageIs('mql'), 60);
    const r2 = await createRule(as, 'Sans propriétaire', noOwner(), 60);
    const r3 = await createRule(as, 'E-mail bloqué', emailContains('blocked'), -30);
    await settleScoring(t);

    const leadA = await as.mutation(api.features.crm.mutations.createLead, {
      firstName: 'Ada',
      lastName: 'Lovelace',
      lifecycleStage: 'mql',
    });
    let doc = await leadDoc(t, leadA);
    expect(doc?.leadScore).toBe(100); // 60 + 60 clamped
    expect(doc?.scoreBreakdown).toEqual({ [r1]: 60, [r2]: 60 });

    // Negative-only match clamps at 0, and the breakdown still explains it.
    const leadB = await as.mutation(api.features.crm.mutations.createLead, {
      firstName: 'Bob',
      lastName: 'Bloqué',
      email: 'blocked@example.com',
      lifecycleStage: 'sql',
      ownerIds: [emp.userId],
    });
    doc = await leadDoc(t, leadB);
    expect(doc?.leadScore).toBe(0);
    expect(doc?.scoreBreakdown).toEqual({ [r3]: -30 });

    // The very write that breaks a rule re-scores the lead.
    await as.mutation(api.features.crm.mutations.updateLead, {
      leadId: leadA,
      ownerIds: [emp.userId],
    });
    doc = await leadDoc(t, leadA);
    expect(doc?.leadScore).toBe(60);
    expect(doc?.scoreBreakdown).toEqual({ [r1]: 60 });
  });

  test('decay halves points per half-life and books the nightly recomputation', async () => {
    // Pure math first: +10 with a 7-day half-life.
    const now = Date.now();
    const rule = {
      _id: 'r1',
      points: 10,
      active: true,
      order: 0,
      decayHalfLifeDays: 7,
      criteria: openedInLastDays(30),
    } as unknown as Doc<'scoringRules'>;
    const leadAt = (openAt: number) => ({ lastEmailOpenAt: openAt }) as unknown as Doc<'leads'>;
    expect(computeLeadScore(leadAt(now), [rule], now).score).toBe(10);
    expect(computeLeadScore(leadAt(now - 7 * DAY), [rule], now).score).toBe(5);
    expect(computeLeadScore(leadAt(now - 21 * DAY), [rule], now).score).toBe(1);

    const { t, as } = await setup();
    await createRule(as, 'Actif 30 j', activeInLastDays(30), 10, { decayHalfLifeDays: 7 });
    await settleScoring(t);
    const leadId = await as.mutation(api.features.crm.mutations.createLead, {
      firstName: 'Tim',
      lastName: 'Décroissant',
    });
    // A note stamps lastActivityAt through the wrapped db → scored on the spot.
    await as.mutation(api.features.crm.mutations.createNote, { leadId, content: 'Appelé.' });
    expect((await leadDoc(t, leadId))?.leadScore).toBe(10);

    // The finished recompute booked the nightly drift job (decay present).
    const state = await t.run((ctx) => ctx.db.query('scoringState').first());
    expect(state?.nextRecalcId).toBeDefined();
    const job = await t.run((ctx) => state?.nextRecalcId && ctx.db.system.get(state.nextRecalcId));
    expect(job?.name).toContain('startScheduledScoreRecompute');

    // Seven days later, the nightly entry point halves the contribution.
    try {
      setSystemTime(new Date(Date.now() + 7 * DAY));
      await t.mutation(internal.features.scoring.internal.startScheduledScoreRecompute, {});
      await settleScoring(t);
      expect((await leadDoc(t, leadId))?.leadScore).toBe(5);
    } finally {
      setSystemTime();
    }
  });

  test('the score_threshold_crossed trigger fires once per crossing', async () => {
    const { t, as } = await setup();
    const ruleId = await createRule(as, 'MQL', stageIs('mql'), 60);
    await settleScoring(t);

    const workflowId = await as.mutation(api.features.workflows.mutations.createWorkflow, {
      name: 'Wf seuil 50',
      trigger: { type: 'score_threshold_crossed', threshold: 50, direction: 'up' },
      allowReEnrollment: true,
      nodes: [{ id: 'n1', type: 'wait', amount: 1, unit: 'hours' }],
      startNodeId: 'n1',
    });
    await as.mutation(api.features.workflows.mutations.setWorkflowStatus, {
      workflowId,
      status: 'active',
    });

    const leadId = await as.mutation(api.features.crm.mutations.createLead, {
      firstName: 'Grace',
      lastName: 'Hopper',
      lifecycleStage: 'lead',
    });
    const runCount = () =>
      t.run(async (ctx) => (await ctx.db.query('workflowRuns').collect()).length);
    expect(await runCount()).toBe(0);

    // 0 → 60 crosses 50 upward: one enrollment.
    await as.mutation(api.features.crm.mutations.updateLead, { leadId, lifecycleStage: 'mql' });
    expect((await leadDoc(t, leadId))?.leadScore).toBe(60);
    expect(await runCount()).toBe(1);

    // Unrelated edit, score unchanged: no new run.
    await as.mutation(api.features.crm.mutations.updateLead, { leadId, firstName: 'Grace M.' });
    expect(await runCount()).toBe(1);

    // 60 → 0 crosses downward: the up-workflow stays quiet.
    await as.mutation(api.features.scoring.mutations.updateScoringRule, {
      ruleId,
      active: false,
    });
    await settleScoring(t);
    expect((await leadDoc(t, leadId))?.leadScore).toBe(0);
    expect(await runCount()).toBe(1);

    // 0 → 60 again: a second crossing, a second run.
    await as.mutation(api.features.scoring.mutations.updateScoringRule, { ruleId, active: true });
    await settleScoring(t);
    expect((await leadDoc(t, leadId))?.leadScore).toBe(60);
    expect(await runCount()).toBe(2);
  });

  test('score promotion moves leads up to the target stage, never down', async () => {
    const { t, as } = await setup();
    // allowRegression on purpose: the promotion guard itself must refuse demotions.
    await as.mutation(api.features.config.mutations.updateLifecycleConfig, {
      stages: [...DEFAULT_LIFECYCLE_STAGES],
      defaultStage: 'lead',
      allowRegression: true,
      scorePromotion: { stage: 'mql', minScore: 50 },
    });
    await createRule(as, 'Sans propriétaire', noOwner(), 60);
    await settleScoring(t);

    const leadA = await as.mutation(api.features.crm.mutations.createLead, {
      firstName: 'Marie',
      lastName: 'Curie',
      lifecycleStage: 'lead',
    });
    const docA = await leadDoc(t, leadA);
    expect(docA?.leadScore).toBe(60);
    expect(docA?.lifecycleStage).toBe('mql');
    const history = await t.run((ctx) =>
      ctx.db
        .query('lifecycleStageHistory')
        .withIndex('by_lead', (q) => q.eq('leadId', leadA))
        .collect(),
    );
    // Exactly one: queued trigger re-runs on the same write must not repeat the promotion.
    expect(history.filter((h) => h.source === 'score' && h.to === 'mql')).toHaveLength(1);

    // Already past the target stage: the score never demotes.
    const leadB = await as.mutation(api.features.crm.mutations.createLead, {
      firstName: 'Claire',
      lastName: 'Cliente',
      lifecycleStage: 'customer',
    });
    const docB = await leadDoc(t, leadB);
    expect(docB?.leadScore).toBe(60);
    expect(docB?.lifecycleStage).toBe('customer');
  });

  test('changing the promotion config sweeps already-scored leads', async () => {
    const { t, as } = await setup();
    await createRule(as, 'Sans propriétaire', noOwner(), 60);
    await settleScoring(t);

    const leadId = await as.mutation(api.features.crm.mutations.createLead, {
      firstName: 'Rosa',
      lastName: 'Retard',
      lifecycleStage: 'lead',
    });
    // Scored 60, but no promotion is configured yet.
    expect((await leadDoc(t, leadId))?.leadScore).toBe(60);
    expect((await leadDoc(t, leadId))?.lifecycleStage).toBe('lead');

    await as.mutation(api.features.config.mutations.updateLifecycleConfig, {
      stages: [...DEFAULT_LIFECYCLE_STAGES],
      defaultStage: 'lead',
      allowRegression: false,
      scorePromotion: { stage: 'mql', minScore: 50 },
    });
    await settleScoring(t);
    expect((await leadDoc(t, leadId))?.lifecycleStage).toBe('mql');
    const history = await t.run((ctx) =>
      ctx.db
        .query('lifecycleStageHistory')
        .withIndex('by_lead', (q) => q.eq('leadId', leadId))
        .collect(),
    );
    expect(history.filter((h) => h.source === 'score')).toHaveLength(1);
  });

  test('acceptance: the open webhook re-scores the lead and the breakdown explains it', async () => {
    const { t, as } = await setup();
    const rOpen = await createRule(as, 'A ouvert un e-mail (7 j)', openedInLastDays(7), 10);
    const rPerso = await createRule(as, 'E-mail perso', emailContains('gmail'), -5);
    await settleScoring(t);

    const leadId = await as.mutation(api.features.crm.mutations.createLead, {
      firstName: 'Jean',
      lastName: 'Perso',
      email: 'jean.perso@gmail.com',
    });
    let doc = await leadDoc(t, leadId);
    expect(doc?.leadScore).toBe(0); // −5 clamped
    expect(doc?.scoreBreakdown).toEqual({ [rPerso]: -5 });

    // Wire an email campaign send so the Brevo webhook path has a message to hit.
    const campaignId = await as.mutation(api.features.crm.mutations.createCampaign, {
      name: 'Newsletter',
      channel: 'email',
      filter: {},
      subject: 'Bonjour',
      htmlBody: '<p>x</p>',
    });
    await t.mutation(internal.features.crm.internal.prepareCampaignBatch, {
      campaignId,
      filter: {},
    });
    await t.run(async (ctx) => {
      const sends = await ctx.db.query('campaignSends').collect();
      const send = sends.find((s) => s.leadId === leadId);
      if (!send) throw new Error('missing campaign send for the lead');
      await ctx.db.patch(send._id, { brevoMessageId: 'msg-1' });
    });
    await t.mutation(internal.features.crm.internal.recordBrevoEmailEvent, {
      brevoMessageId: 'msg-1',
      type: 'opened',
      eventAt: Date.now(),
    });

    doc = await leadDoc(t, leadId);
    expect(doc?.leadScore).toBe(5); // +10 − 5
    expect(doc?.scoreBreakdown).toEqual({ [rOpen]: 10, [rPerso]: -5 });
  });

  test('rules are validated and the simulation counts leads above the threshold', async () => {
    const { t, as } = await setup();
    const create = (
      over: Partial<Parameters<typeof createRule>[4]> & { points?: number },
      criteria = stageIs('mql'),
    ) =>
      as.mutation(api.features.scoring.mutations.createScoringRule, {
        name: 'Règle',
        criteria,
        points: over.points ?? 10,
        active: true,
      });
    await expect(create({ points: 0 })).rejects.toThrow('invalid_scoring_points');
    await expect(create({ points: 2.5 })).rejects.toThrow('invalid_scoring_points');
    await expect(create({ points: 150 })).rejects.toThrow('invalid_scoring_points');
    await expect(create({}, { combinator: 'and', groups: [] })).rejects.toThrow(
      'scoring_criteria_required',
    );
    await expect(
      create(
        {},
        oneRule({
          field: { kind: 'standard', field: 'listIds' },
          operator: 'equals',
          value: ['x'],
        }),
      ),
    ).rejects.toThrow('scoring_criteria_forbidden_field');
    await expect(
      create(
        {},
        oneRule({ field: { kind: 'standard', field: 'leadScore' }, operator: 'gt', value: 10 }),
      ),
    ).rejects.toThrow('scoring_criteria_forbidden_field');
    await expect(
      as.mutation(api.features.scoring.mutations.createScoringRule, {
        name: 'Décroissance invalide',
        criteria: stageIs('mql'),
        points: 10,
        active: true,
        decayHalfLifeDays: -1,
      }),
    ).rejects.toThrow('invalid_scoring_decay');

    await createRule(as, 'MQL', stageIs('mql'), 60);
    await settleScoring(t);
    for (const [i, stage] of ['mql', 'mql', 'sql'].entries()) {
      await as.mutation(api.features.crm.mutations.createLead, {
        firstName: `Lead${i}`,
        lastName: 'Simulé',
        lifecycleStage: stage,
      });
    }
    await as.mutation(api.features.scoring.mutations.startScoreSimulation, { threshold: 50 });
    const sim = await settleSimulation(t);
    expect(sim).toMatchObject({ threshold: 50, matched: 2, processed: 3 });
  });
});
