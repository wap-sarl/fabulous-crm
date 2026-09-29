import { z } from 'zod';
import {
  type BeaconView,
  LINK_GRANT_PARAM,
  LINK_GRANT_RE,
  MAX_BEACON_EVENTS,
  MAX_TITLE_LENGTH,
  MAX_URL_LENGTH,
  VISITOR_ID_RE,
} from '../../_lib/validators/tracking';

const DAY_MS = 24 * 60 * 60 * 1000;

const beaconSchema = z.object({
  v: z.string().regex(VISITOR_ID_RE),
  // A value of the wrong shape is no grant, not a bad beacon.
  l: z.string().regex(LINK_GRANT_RE).optional().catch(undefined),
  e: z.array(z.unknown()),
});
const viewSchema = z.object({
  u: z.string().trim().max(MAX_URL_LENGTH),
  t: z.string().optional().catch(undefined),
  r: z.string().optional().catch(undefined),
  at: z.number().optional().catch(undefined),
});

export interface Beacon {
  visitorId: string;
  grant?: string;
  views: BeaconView[];
}

/** A view worth storing: on the site that sent it, within bounds, the time clamped to the last day. */
function cleanView(raw: unknown, origin: string, now: number): BeaconView | null {
  const parsed = viewSchema.safeParse(raw);
  if (!parsed.success) return null;
  let url: URL;
  try {
    url = new URL(parsed.data.u);
  } catch {
    return null;
  }
  if (url.origin !== origin) return null;
  // The script strips it from the address bar; a page that kept it does not get it stored.
  url.searchParams.delete(LINK_GRANT_PARAM);
  const referrer = parsed.data.r;
  return {
    url: url.toString(),
    path: url.pathname || '/',
    title: parsed.data.t?.trim().slice(0, MAX_TITLE_LENGTH) || undefined,
    referrer:
      referrer && /^https?:\/\//i.test(referrer) ? referrer.slice(0, MAX_URL_LENGTH) : undefined,
    // A clock a day off is the browser's business; further than that it is noise.
    at: Math.min(now, Math.max(now - DAY_MS, parsed.data.at ?? now)),
  };
}

/** The one boundary of a beacon: its body parsed, its views cleaned; null when it is not a beacon. */
export function parseBeacon(text: string, origin: string, now: number): Beacon | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  const parsed = beaconSchema.safeParse(raw);
  if (!parsed.success) return null;
  const views = parsed.data.e
    .slice(0, MAX_BEACON_EVENTS)
    .map((item) => cleanView(item, origin, now))
    .filter((view): view is BeaconView => view !== null);
  return { visitorId: parsed.data.v, grant: parsed.data.l, views };
}
