// What a channel that is one HTTP call sends and answers; on its own so that a channel's file and the registry do not import each other.

/** What a channel that is one HTTP call sends: the text, and the address that opens the record. */
export interface ChannelMessage {
  title: string;
  body: string;
  url: string;
}

/** What became of a send: `refused` is an answer that will not change, `failed` one that may pass later, `wait` the service saying when to come back (ms), which the delivery honours without counting an attempt. */
export type SendResult = 'sent' | 'refused' | 'failed' | { wait: number };

/** What a 429 asks: the `Retry-After` header (seconds, or a date), else Discord's `retry_after` in the body (seconds); `failed` when the answer says nothing usable, and the backoff decides. */
export async function waitAskedBy(response: Response): Promise<SendResult> {
  const header = response.headers.get('retry-after');
  let seconds = header ? Number(header) : Number.NaN;
  if (header && Number.isNaN(seconds)) seconds = (Date.parse(header) - Date.now()) / 1000;
  if (Number.isNaN(seconds)) {
    try {
      const body: unknown = await response.json();
      const asked = (body as { retry_after?: unknown } | null)?.retry_after;
      if (typeof asked === 'number') seconds = asked;
    } catch {
      // Not JSON: nothing asked.
    }
  }
  // Zero means « now »: a wait all the same, which the floor raises to a second.
  return Number.isFinite(seconds) && seconds >= 0 ? { wait: Math.ceil(seconds * 1000) } : 'failed';
}
