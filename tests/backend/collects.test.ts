import { expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { overlayRules } from '../support/overlayRules';

const ROOT = join(import.meta.dir, '../../convex');

/** Tables that are small by nature: what an administrator sets up by hand, never what the use of the product fills. */
const SMALL: Record<string, string> = {
  apiKeys: 'the keys an administrator issued',
  forms: 'the capture forms of the settings',
  invitations: 'one per person invited',
  'invitations.by_status': 'one per person invited',
  leadLists: 'the lists people named; read where every list is shown or checked',
  'leadLists.by_kind': 'the dynamic lists, capped by maxDynamicLists',
  pipelines: 'the pipelines of the settings',
  propertyDefinitions: 'the custom properties of the settings',
  'propertyDefinitions.by_entityType': 'the custom properties of one entity',
  roles: 'the roles of the settings',
  scoringRules: 'the scoring rules of the settings',
  teams: 'the teams of the settings',
  'users.by_type': 'the employees',
  workflows: 'the workflows people built; read where all of them are listed',
  'workflows.by_status': 'the workflows that run',
  'importMappings.by_entity': 'the saved mappings of one entity',
  'connectorAccounts.by_user_provider': 'the accounts one person connected',
};

/** Index ranges bounded by what they hang from: the rows of one parent, which the product keeps few. */
const BOUNDED: Record<string, string> = {
  'attachments.by_entity': 'the files of one record',
  'campaignEvents.by_send': 'the events of one send: a handful',
  'campaignLinkTokens.by_send': 'the tracked links of one send: those of the message',
  'dealStageHistory.by_deal': 'the stage changes of one deal',
  'deals.by_lead': 'the deals of one contact',
  'importRows.by_job_index': 'a range of rows the caller bounds by index',
  'leadDuplicates.index': 'the duplicate pairs of one contact',
  'leadNotes.by_lead': 'the notes of one contact',
  'leads.by_email': 'the contacts sharing one address: duplicates, a few',
  'lifecycleStageHistory.by_lead': 'the stage changes of one contact',
  'workflowRunSteps.by_run': 'the steps of one run, at most MAX_STEPS_PER_RUN',
  'workflowRuns.by_lead': 'the runs of one contact',
  'workflowRuns.by_workflow_lead': 'the runs of one contact in one workflow, at most 5 a day',
  'lib/timeline/sources.ts':
    'the helper of the timeline: a page read again, bounded by the page before',
};

/** Reads that grow with the use of the product and are not bounded yet: each needs its screen redesigned (counters, pages), which is not a cleanup. Nothing is added here. */
const KNOWN_UNBOUNDED: Record<string, string> = {
  campaigns: 'the list of campaigns shows them all',
  'campaigns.by_status_updatedAt': 'the purge walks the closed campaigns past their retention',
  'campaignSends.by_campaign':
    'the page of a campaign counts and lists every send; a resend requeues them all',
  'campaignSends.by_campaign_status': 'failing the pending sends of a campaign takes them all',
  'companies.by_name': 'the company options of the lead filters hold every company',
};

function sourcesOf(dir: string): string[] {
  return readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === '_generated' ? [] : sourcesOf(path);
    return entry.name.endsWith('.ts') ? [path] : [];
  });
}

/** What each `.collect()` reads: `table`, `table.index`, or the file when the query is built elsewhere. */
function collectsOf(file: string): string[] {
  const source = readFileSync(join(ROOT, file), 'utf8');
  return [...source.matchAll(/\.collect\(\)/g)].map((match) => {
    const before = source.slice(0, match.index);
    const chain = before.slice(before.lastIndexOf('.query('));
    const table = /^\.query\(\s*'(\w+)'/.exec(chain)?.[1];
    if (!table || chain.includes(';')) return file;
    const index = /\.withIndex\(\s*'?(\w+)/.exec(chain)?.[1];
    return index ? `${table}.${index}` : table;
  });
}

test('a query reads a whole table or a whole index range only where that is small, and says why', () => {
  const read = sourcesOf('.').flatMap((file) => collectsOf(file).map((what) => ({ file, what })));
  const ofCore = { ...SMALL, ...BOUNDED, ...KNOWN_UNBOUNDED };
  // An overlay adds its own reads: it cannot take over an entry of the core, and each of its entries says why.
  expect(Object.keys(overlayRules.smallReads).filter((what) => what in ofCore)).toEqual([]);
  const allowed = { ...ofCore, ...overlayRules.smallReads };
  expect(Object.entries(allowed).filter(([, reason]) => !reason.trim())).toEqual([]);
  expect(read.filter(({ what }) => !(what in allowed)).map((r) => `${r.file}: ${r.what}`)).toEqual(
    [],
  );
  // A reason that no longer excuses anything is removed with the read it excused.
  const used = new Set(read.map((r) => r.what));
  expect(Object.keys(allowed).filter((what) => !used.has(what))).toEqual([]);
});

test('the reads that are not bounded yet are these, and their number only goes down', () => {
  const unbounded = sourcesOf('.')
    .flatMap(collectsOf)
    .filter((what) => what in KNOWN_UNBOUNDED);
  expect(unbounded.sort()).toEqual([
    'campaignSends.by_campaign',
    'campaignSends.by_campaign',
    'campaignSends.by_campaign_status',
    'campaigns',
    'campaigns.by_status_updatedAt',
    'companies.by_name',
  ]);
});
