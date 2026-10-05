/** What the leads matching a filter amount to. */
export type MatchingLeadCount = { total: number; withEmail: number; withPhone: number };

type MatchingPage = {
  leadIds: unknown[];
  withEmail: number;
  withPhone: number;
  cursor: string | null;
};

/** Adds up the pages of the matching leads, following the cursor to its end; `null` when `cancelled` says the answer is no longer wanted. */
export async function countMatchingLeads(
  fetchPage: (cursor: string | null) => Promise<MatchingPage>,
  cancelled: () => boolean,
): Promise<MatchingLeadCount | null> {
  const count = { total: 0, withEmail: 0, withPhone: 0 };
  let cursor: string | null = null;
  do {
    const page = await fetchPage(cursor);
    if (cancelled()) return null;
    count.total += page.leadIds.length;
    count.withEmail += page.withEmail;
    count.withPhone += page.withPhone;
    cursor = page.cursor;
  } while (cursor !== null);
  return count;
}
