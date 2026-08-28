import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_PIPELINE_STAGES,
  allowedTargets,
  analyzePipelineGraph,
  defaultTransitions,
  effectiveTransitions,
  fullTransitions,
  isFullTransitions,
  isTransitionAllowed,
  normalizeTransitions,
  pruneTransitions,
  validatePipelineTransitions,
  type PipelineTransition,
} from '../../convex/_lib/validators/deals';

const stages = [...DEFAULT_PIPELINE_STAGES];
// The stock funnel, one arrow per step; won and lost from the last open stage.
const linear: PipelineTransition[] = [
  { from: 'new', to: 'qualified' },
  { from: 'qualified', to: 'proposal' },
  { from: 'proposal', to: 'negotiation' },
  { from: 'negotiation', to: 'won' },
  { from: 'negotiation', to: 'lost' },
];
const without = (list: PipelineTransition[], from: string, to: string) =>
  list.filter((t) => !(t.from === from && t.to === to));

describe('pipeline transition graph (pure)', () => {
  test('an absent graph is the default one: next stage and back; an explicit one only its arrows', () => {
    expect(defaultTransitions(stages)).toEqual([
      { from: 'new', to: 'qualified' },
      { from: 'qualified', to: 'new' },
      { from: 'qualified', to: 'proposal' },
      { from: 'proposal', to: 'qualified' },
      { from: 'proposal', to: 'negotiation' },
      { from: 'negotiation', to: 'proposal' },
      { from: 'negotiation', to: 'won' },
      { from: 'won', to: 'negotiation' },
      { from: 'negotiation', to: 'lost' },
      { from: 'lost', to: 'negotiation' },
    ]);
    const absent = { stages };
    expect(effectiveTransitions(absent)).toEqual(defaultTransitions(stages));
    expect(isTransitionAllowed(absent, 'new', 'qualified')).toBe(true);
    expect(isTransitionAllowed(absent, 'qualified', 'new')).toBe(true);
    expect(isTransitionAllowed(absent, 'new', 'proposal')).toBe(false);
    expect(isTransitionAllowed(absent, 'new', 'won')).toBe(false);
    expect(isTransitionAllowed(absent, 'won', 'negotiation')).toBe(true);
    // Staying put is never a transition.
    expect(isTransitionAllowed(absent, 'new', 'new')).toBe(true);
    expect(allowedTargets(absent, 'new')).toEqual(['qualified']);
    expect(allowedTargets(absent, 'negotiation')).toEqual(['proposal', 'won', 'lost']);

    const strict = { stages, transitions: linear };
    expect(effectiveTransitions(strict)).toBe(linear);
    expect(isTransitionAllowed(strict, 'new', 'qualified')).toBe(true);
    expect(isTransitionAllowed(strict, 'qualified', 'new')).toBe(false);
    expect(isTransitionAllowed(strict, 'negotiation', 'qualified')).toBe(false);
    expect(allowedTargets(strict, 'negotiation')).toEqual(['won', 'lost']);
    expect(allowedTargets(strict, 'won')).toEqual([]);
  });

  test('the complete graph goes both ways; the default graph collapses to absent', () => {
    // 4 open stages × 5 others + 2 closed stages × 4 open (reopen arrows).
    const full = fullTransitions(stages);
    expect(full).toHaveLength(4 * 5 + 2 * 4);
    expect(full).toContainEqual({ from: 'negotiation', to: 'new' });
    expect(full).toContainEqual({ from: 'lost', to: 'new' });
    expect(full).not.toContainEqual({ from: 'won', to: 'lost' });
    expect(isFullTransitions(stages, full)).toBe(true);
    expect(isFullTransitions(stages, [...full].reverse())).toBe(true);
    expect(isFullTransitions(stages, linear)).toBe(false);
    expect(isFullTransitions(stages, undefined)).toBe(false);
    expect(analyzePipelineGraph(stages, full)).toEqual([]);
    expect(normalizeTransitions(stages, full)).toHaveLength(full.length);
    expect(normalizeTransitions(stages, defaultTransitions(stages))).toBeUndefined();
    expect(normalizeTransitions(stages, [...defaultTransitions(stages)].reverse())).toBeUndefined();
    expect(normalizeTransitions(stages, linear)).toEqual(linear);
    expect(normalizeTransitions(stages, undefined)).toBeUndefined();
  });

  test('structural validation: unknown stage, self-loop, duplicate, closed → closed', () => {
    expect(validatePipelineTransitions(stages, linear)).toBeNull();
    expect(validatePipelineTransitions(stages, undefined)).toBeNull();
    expect(validatePipelineTransitions(stages, [{ from: 'new', to: 'nope' }])).toBe(
      'pipeline_transition_unknown_stage',
    );
    expect(validatePipelineTransitions(stages, [{ from: 'new', to: 'new' }])).toBe(
      'pipeline_transition_self_loop',
    );
    expect(
      validatePipelineTransitions(stages, [
        { from: 'new', to: 'qualified' },
        { from: 'new', to: 'qualified' },
      ]),
    ).toBe('pipeline_transition_duplicate');
    expect(validatePipelineTransitions(stages, [{ from: 'won', to: 'lost' }])).toBe(
      'pipeline_transition_from_closed',
    );
    // Backward arrows and reopen arrows are ordinary transitions.
    expect(
      validatePipelineTransitions(stages, [
        { from: 'negotiation', to: 'new' },
        { from: 'lost', to: 'new' },
      ]),
    ).toBeNull();
  });

  test('a removed stage takes its arrows along', () => {
    const fewer = stages.filter((s) => s.key !== 'proposal');
    expect(pruneTransitions(linear, fewer)).toEqual([
      { from: 'new', to: 'qualified' },
      { from: 'negotiation', to: 'won' },
      { from: 'negotiation', to: 'lost' },
    ]);
    expect(pruneTransitions(undefined, fewer)).toBeUndefined();
  });

  test('the validator: coherent graph, unreachable stage, dead end', () => {
    expect(analyzePipelineGraph(stages, undefined)).toEqual([]);
    expect(analyzePipelineGraph(stages, defaultTransitions(stages))).toEqual([]);
    expect(analyzePipelineGraph(stages, linear)).toEqual([]);

    // Cutting an arrow of the complete graph is harmless while every stage
    // keeps a way in and a way out…
    const full = fullTransitions(stages);
    expect(analyzePipelineGraph(stages, without(full, 'new', 'qualified'))).toEqual([]);
    // …removing every arrow into a stage strands it, every arrow out of it makes it a dead end.
    const noWayIn = full.filter((t) => t.to !== 'proposal');
    expect(analyzePipelineGraph(stages, noWayIn)).toEqual([
      { kind: 'unreachable', stageKey: 'proposal' },
    ]);
    const noWayOut = full.filter((t) => t.from !== 'proposal');
    expect(analyzePipelineGraph(stages, noWayOut)).toEqual([
      { kind: 'dead_end', stageKey: 'proposal' },
    ]);
    // A reopen arrow is a way in (through « Perdue »)…
    const onlyReopen = [...noWayIn, { from: 'lost', to: 'proposal' }];
    expect(analyzePipelineGraph(stages, onlyReopen)).toEqual([]);
    // …and a backward arrow is a way out like any other (it rejoins the funnel).
    expect(analyzePipelineGraph(stages, [...noWayOut, { from: 'proposal', to: 'new' }])).toEqual(
      [],
    );

    // In the linear funnel every arrow is load-bearing: cutting the only
    // arrow into « Négociation » strands it (and « Gagnée », only reached
    // through it) and leaves « Proposition » without a way to close.
    const funnel = [...linear, { from: 'qualified', to: 'lost' }];
    expect(analyzePipelineGraph(stages, funnel)).toEqual([]);
    const cut = without(funnel, 'proposal', 'negotiation');
    expect(analyzePipelineGraph(stages, cut)).toEqual([
      { kind: 'unreachable', stageKey: 'negotiation' },
      { kind: 'unreachable', stageKey: 'won' },
      { kind: 'dead_end', stageKey: 'proposal' },
    ]);

    // An empty graph: everything but the entry stage is unreachable, every
    // open stage is a dead end.
    const issues = analyzePipelineGraph(stages, []);
    expect(issues.filter((i) => i.kind === 'unreachable').map((i) => i.stageKey)).toEqual([
      'qualified',
      'proposal',
      'negotiation',
      'won',
      'lost',
    ]);
    expect(issues.filter((i) => i.kind === 'dead_end').map((i) => i.stageKey)).toEqual([
      'new',
      'qualified',
      'proposal',
      'negotiation',
    ]);
  });
});
