import { ConvexError, type Value } from 'convex/values';

/** What a refusal carries with its code: `reason` details it (a field, a bound), `message` is a sentence for the person, the rest is for whoever words it. */
type RefusalData = { reason?: string; message?: string } & Record<string, Value | undefined>;

/** A refusal the caller can act on, to throw: its `{ code, …data }` reaches the client in production too, where a plain Error arrives as « Server Error ». */
export function refusal(code: string, data: RefusalData = {}): ConvexError<Record<string, Value>> {
  const defined = Object.fromEntries(
    Object.entries(data).filter((entry): entry is [string, Value] => entry[1] !== undefined),
  );
  return new ConvexError({ code, ...defined });
}

/** A refusal from the text a validator returns: `code` or `code: reason` as they are, a sentence as the message of `code`. */
export function refusalFrom(text: string, code: string): ConvexError<Record<string, Value>> {
  const [head, ...rest] = text.split(': ');
  if (!/^[a-z][a-z0-9_]*$/.test(head)) return refusal(code, { message: text });
  return refusal(head, { reason: rest.join(': ') || undefined });
}

/** The code and the reason an error carries: those of a refusal, else what its message spells as `code` or `code: reason`; null for anything else. */
export function refusalOf(error: unknown): { code: string; reason?: string } | null {
  if (error instanceof ConvexError) {
    const data: unknown = error.data;
    if (data && typeof data === 'object' && typeof (data as { code?: unknown }).code === 'string') {
      const { code, reason } = data as { code: string; reason?: unknown };
      return { code, ...(typeof reason === 'string' && { reason }) };
    }
    return null;
  }
  if (!(error instanceof Error)) return null;
  const [code, ...rest] = error.message.split(': ');
  if (!/^[a-z][a-z0-9_]*$/.test(code)) return null;
  const reason = rest.join(': ');
  return { code, ...(reason && { reason }) };
}

/** An error as it is stored or logged: `code` or `code: reason` for a refusal, else its message. */
export function refusalText(error: unknown, fallback: string): string {
  const known = refusalOf(error);
  if (known) return known.reason ? `${known.code}: ${known.reason}` : known.code;
  return error instanceof Error ? error.message : fallback;
}
