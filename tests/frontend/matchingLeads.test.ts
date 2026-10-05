import { describe, expect, test } from 'bun:test';
import { countMatchingLeads } from '../../src/features/leads/lib/matchingLeads';

const page = (leads: number, withEmail: number, withPhone: number, cursor: string | null) => ({
  leadIds: Array.from({ length: leads }),
  withEmail,
  withPhone,
  cursor,
});

describe('counting the leads that match a filter', () => {
  test('the pages are added up, each asked with the cursor the one before gave', async () => {
    const pages = { start: page(3, 2, 1, 'a'), a: page(0, 0, 0, 'b'), b: page(2, 2, 2, null) };
    const asked: (string | null)[] = [];
    const count = await countMatchingLeads(
      async (cursor) => {
        asked.push(cursor);
        return pages[(cursor ?? 'start') as keyof typeof pages];
      },
      () => false,
    );
    expect(count).toEqual({ total: 5, withEmail: 4, withPhone: 3 });
    expect(asked).toEqual([null, 'a', 'b']);
  });

  test('no lead at all is a count of nothing, in one page', async () => {
    expect(
      await countMatchingLeads(
        async () => page(0, 0, 0, null),
        () => false,
      ),
    ).toEqual({ total: 0, withEmail: 0, withPhone: 0 });
  });

  test('a count nobody waits for any more stops after the page it was on, and gives nothing', async () => {
    let asked = 0;
    const count = await countMatchingLeads(
      async () => {
        asked++;
        return page(1, 1, 1, 'more');
      },
      () => asked >= 2,
    );
    expect(count).toBeNull();
    expect(asked).toBe(2);
  });

  test('a page that fails is a failure of the count', async () => {
    await expect(
      countMatchingLeads(
        async () => {
          throw new Error('lost');
        },
        () => false,
      ),
    ).rejects.toThrow('lost');
  });
});
