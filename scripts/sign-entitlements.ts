// Dev helper: signs an entitlements token with a throwaway key pair kept in .entitlements-dev-key.json.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { EE_FEATURES, type EeFeature } from '../ee/contract';
import { type EntitlementsPayload, PLANS, type Plan } from '../convex/_lib/validators/entitlements';
import { generateEntitlementsKeyPair, signEntitlements } from './lib/entitlementsSigner';

const KEY_FILE = new URL('../.entitlements-dev-key.json', import.meta.url);
const DAY_MS = 24 * 60 * 60 * 1000;

const { values } = parseArgs({
  options: {
    tenant: { type: 'string' },
    plan: { type: 'string', default: 'pro' },
    seats: { type: 'string' },
    'workflow-runs': { type: 'string' },
    'api-calls': { type: 'string' },
    'audit-days': { type: 'string' },
    'events-days': { type: 'string' },
    features: { type: 'string', default: '' },
    days: { type: 'string', default: '30' },
    key: { type: 'string' },
  },
});

const number = (raw: string | undefined) => (raw === undefined ? null : Number(raw));
const plan = values.plan as Plan;
if (!values.tenant) throw new Error('--tenant <id> is required (must equal TENANT_ID).');
if (!PLANS.includes(plan)) throw new Error(`--plan must be one of ${PLANS.join(', ')}.`);
const features = values.features
  .split(',')
  .map((f) => f.trim())
  .filter(Boolean) as EeFeature[];
const unknown = features.find((f) => !EE_FEATURES.includes(f));
if (unknown) throw new Error(`Unknown feature ${unknown}; known: ${EE_FEATURES.join(', ')}.`);

const keyPath = values.key ? new URL(values.key, `file://${process.cwd()}/`) : KEY_FILE;
let pair: { privateJwk: JsonWebKey; publicJwk: JsonWebKey };
if (existsSync(keyPath)) {
  pair = JSON.parse(readFileSync(keyPath, 'utf8'));
} else {
  pair = await generateEntitlementsKeyPair();
  writeFileSync(keyPath, JSON.stringify(pair, null, 2));
  console.error(`New key pair written to ${keyPath.pathname}`);
}

const now = Date.now();
const payload: EntitlementsPayload = {
  tenant: values.tenant,
  plan,
  seats: number(values.seats),
  workflowRunsPerMonth: number(values['workflow-runs']),
  apiCallsPerMonth: number(values['api-calls']),
  retentionDays: { audit: number(values['audit-days']), events: number(values['events-days']) },
  features,
  iat: now,
  exp: now + Number(values.days) * DAY_MS,
};
console.error('Public key to add to convex/lib/entitlementsKeys.ts for local use:');
console.error(JSON.stringify(pair.publicJwk));
console.log(await signEntitlements(pair.privateJwk, payload));
