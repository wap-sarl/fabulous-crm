import { describe, expect, test } from 'bun:test';
import * as campaignActions from '../../convex/features/campaigns/actions';
import * as campaignInternal from '../../convex/features/campaigns/internal';
import * as campaignMutations from '../../convex/features/campaigns/mutations';
import * as campaignQueries from '../../convex/features/campaigns/queries';
import * as consentMutations from '../../convex/features/consent/mutations';
import * as consentQueries from '../../convex/features/consent/queries';
import * as oldActions from '../../convex/features/crm/actions';
import * as oldInternal from '../../convex/features/crm/internal';
import * as oldMutations from '../../convex/features/crm/mutations';
import * as oldQueries from '../../convex/features/crm/queries';
import * as listInternal from '../../convex/features/leadLists/internal';
import * as listMutations from '../../convex/features/leadLists/mutations';
import * as listQueries from '../../convex/features/leadLists/queries';
import * as leadMutations from '../../convex/features/leads/mutations';
import * as leadQueries from '../../convex/features/leads/queries';

type Module = Record<string, unknown>;

// An overlay pinned on the release before, and the jobs a deployment scheduled before the split, call the old paths.
const SPLIT: [string, Module, Module[]][] = [
  ['queries', oldQueries, [leadQueries, listQueries, campaignQueries, consentQueries]],
  ['mutations', oldMutations, [leadMutations, listMutations, campaignMutations, consentMutations]],
  ['internal', oldInternal, [listInternal, campaignInternal]],
  ['actions', oldActions, [campaignActions]],
];

/** Written after the split: no caller knows them at an old path. */
const BORN_AFTER = ['dynamicListLimits', 'matchingLeadsPage'];

describe('the paths of before the split of features/crm', () => {
  test.each(SPLIT)(
    '%s: every function answers at its old path, the very same function',
    (_kind, old, parts) => {
      const isFunction = (value: unknown) =>
        typeof value === 'function' &&
        ('isQuery' in value || 'isMutation' in value || 'isAction' in value);
      const moved = parts.flatMap((part) =>
        Object.entries(part).filter(
          ([name, value]) => isFunction(value) && !BORN_AFTER.includes(name),
        ),
      );
      expect(moved.length).toBeGreaterThan(0);
      for (const [name, fn] of moved) expect(old[name], name).toBe(fn);
      expect(Object.keys(old).sort()).toEqual(moved.map(([name]) => name).sort());
    },
  );
});
