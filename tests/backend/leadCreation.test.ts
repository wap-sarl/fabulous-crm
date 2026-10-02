import { expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { apiCall, createKey } from './apiClient';
import {
  asIdentity,
  createTestConvex,
  pinClock,
  seedConfig,
  seedEmployee,
  type T,
} from './helpers';

const NOW = Date.parse('2026-10-01T09:00:00Z');

async function setup() {
  process.env.BETTER_AUTH_SECRET = 'test-auth-secret';
  pinClock(NOW);
  const t = createTestConvex();
  const emp = await seedEmployee(t, { email: 'agent@example.com', role: 'admin' });
  const as = asIdentity(t, emp.identity);
  await seedConfig(t);
  // Enrols every contact that has submitted a form by the time `lead_created` is dispatched.
  const workflowId = await as.mutation(api.features.workflows.mutations.createWorkflow, {
    name: 'Bienvenue',
    trigger: { type: 'lead_created' },
    allowReEnrollment: false,
    nodes: [{ id: 'n1', type: 'wait', amount: 1, unit: 'hours' }],
    startNodeId: 'n1',
    enrollmentCriteria: {
      combinator: 'and',
      groups: [
        {
          combinator: 'and',
          rules: [
            {
              field: { kind: 'standard', field: 'formSubmissionCount' },
              operator: 'gt',
              value: 0,
            },
          ],
        },
      ],
    },
  });
  await as.mutation(api.features.workflows.mutations.setWorkflowStatus, {
    workflowId,
    status: 'active',
  });
  const everyone = await as.mutation(api.features.workflows.mutations.createWorkflow, {
    name: 'Tous',
    trigger: { type: 'lead_created' },
    allowReEnrollment: false,
    nodes: [{ id: 'n1', type: 'wait', amount: 1, unit: 'hours' }],
    startNodeId: 'n1',
  });
  await as.mutation(api.features.workflows.mutations.setWorkflowStatus, {
    workflowId: everyone,
    status: 'active',
  });
  return { t, emp, as, afterForm: workflowId, everyone };
}

/** Everything a creation leaves: the contact, its journal, its lifecycle history and the workflows it entered. */
async function traceOf(t: T, leadId: Id<'leads'>) {
  return await t.run(async (ctx) => {
    const lead = (await ctx.db.get(leadId))!;
    const { _id, _creationTime, consentToken, searchText, dedupe, ...fields } = lead;
    const audits = (await ctx.db.query('auditLogs').collect())
      .filter((a) => a.entityId === leadId)
      .map(({ action, userId, apiKeyId, metadata }) => ({ action, userId, apiKeyId, metadata }));
    const history = (await ctx.db.query('lifecycleStageHistory').collect())
      .filter((h) => h.leadId === leadId)
      .map(({ from, to, source, changedBy }) => ({ from, to, source, changedBy }));
    const runs = (await ctx.db.query('workflowRuns').collect())
      .filter((r) => r.leadId === leadId)
      .map((r) => r.workflowId);
    return { fields, token: consentToken, audits, history, runs };
  });
}

const TOKEN = /^[0-9a-f]{48}$/;

test('created by an employee: theirs, journaled under their name, no consent', async () => {
  const { t, emp, as, everyone } = await setup();
  const leadId = await as.mutation(api.features.leads.mutations.createLead, {
    firstName: ' Ada ',
    lastName: ' Lovelace ',
    email: ' Ada@Example.com ',
    phone: ' 0102030405 ',
    comment: 'Rencontrée au salon',
  });
  const trace = await traceOf(t, leadId);
  expect(trace.fields).toEqual({
    firstName: 'Ada',
    lastName: 'Lovelace',
    email: 'ada@example.com',
    phone: '0102030405',
    marketingConsent: [],
    comment: 'Rencontrée au salon',
    ownerIds: [],
    isRedFlagged: false,
    lifecycleStage: 'lead',
    createdBy: emp.userId,
    updatedBy: emp.userId,
    updatedAt: NOW,
  });
  expect(trace.token).toMatch(TOKEN);
  expect(trace.audits).toEqual([
    { action: 'create', userId: emp.userId, apiKeyId: undefined, metadata: undefined },
  ]);
  expect(trace.history).toEqual([
    { from: undefined, to: 'lead', source: 'manual', changedBy: emp.userId },
  ]);
  expect(trace.runs).toEqual([everyone]);
});

test('created through the API: journaled under the key, no employee', async () => {
  const { t, as, everyone } = await setup();
  const { key, id: keyId } = await createKey(as, ['contacts:write']);
  const res = await apiCall(t, 'POST', 'contacts', key, {
    firstName: ' Ada ',
    lastName: 'Lovelace',
    email: 'Ada@Example.com',
    isRedFlagged: true,
  });
  expect(res.status).toBe(201);
  const { id } = (await res.json()) as { id: Id<'leads'> };
  const trace = await traceOf(t, id);
  expect(trace.fields).toEqual({
    firstName: 'Ada',
    lastName: 'Lovelace',
    email: 'ada@example.com',
    marketingConsent: [],
    ownerIds: [],
    isRedFlagged: true,
    lifecycleStage: 'lead',
    updatedAt: NOW,
  });
  expect(trace.token).toMatch(TOKEN);
  expect(trace.audits).toEqual([
    { action: 'create', userId: undefined, apiKeyId: keyId, metadata: undefined },
  ]);
  expect(trace.history).toEqual([
    { from: undefined, to: 'lead', source: 'api', changedBy: undefined },
  ]);
  expect(trace.runs).toEqual([everyone]);
});

test('created by an import: owned by the importer unless the row names owners', async () => {
  const { t, emp, as, everyone } = await setup();
  const other = await seedEmployee(t, { email: 'other@example.com', role: 'member' });
  const res = await as.mutation(api.features.leads.mutations.importLeads, {
    rows: [
      { firstName: ' Ada ', lastName: 'Lovelace', email: 'Ada@Example.com' },
      { firstName: 'Bob', lastName: 'Martin', email: 'bob@example.com', ownerIds: [other.userId] },
    ],
  });
  expect(res.created).toBe(2);
  const leads = await t.run((ctx) => ctx.db.query('leads').collect());
  const ada = leads.find((l) => l.email === 'ada@example.com')!;
  const bob = leads.find((l) => l.email === 'bob@example.com')!;
  const trace = await traceOf(t, ada._id);
  expect(trace.fields).toEqual({
    firstName: 'Ada',
    lastName: 'Lovelace',
    email: 'ada@example.com',
    marketingConsent: [],
    ownerIds: [emp.userId],
    isRedFlagged: false,
    lifecycleStage: 'lead',
    createdBy: emp.userId,
    updatedBy: emp.userId,
    updatedAt: NOW,
  });
  expect(trace.token).toMatch(TOKEN);
  expect(trace.audits).toEqual([
    { action: 'create', userId: emp.userId, apiKeyId: undefined, metadata: { source: 'import' } },
  ]);
  expect(trace.history).toEqual([
    { from: undefined, to: 'lead', source: 'import', changedBy: emp.userId },
  ]);
  expect(trace.runs).toEqual([everyone]);
  expect(bob.ownerIds).toEqual([other.userId]);
});

test('created by a form: consent to e-mail, nobody’s, and the submission counted before the workflows look', async () => {
  const { t, as, afterForm, everyone } = await setup();
  const formId = await as.mutation(api.features.forms.mutations.createForm, {
    name: 'Contact',
    fields: [
      { target: { kind: 'standard', field: 'firstName' }, label: 'Prénom', required: true },
      { target: { kind: 'standard', field: 'email' }, label: 'E-mail', required: true },
    ],
    buttonText: 'Envoyer',
    afterSubmit: { kind: 'message', message: 'Merci !' },
    consentText: 'J’accepte de recevoir des communications.',
    active: true,
  });
  const def = await t.fetch(`/forms/${formId}/def`, { method: 'GET' });
  const { ts, sig } = (await def.json()) as { ts: number; sig: string };
  const SUBMITTED = NOW + 5_000;
  pinClock(SUBMITTED);
  const res = await t.fetch(`/forms/${formId}/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      consent: true,
      renderedAt: ts,
      renderSig: sig,
      values: { prenom: 'Ada', 'e-mail': 'Ada@Example.com' },
    }),
  });
  expect(res.status).toBe(200);
  const lead = (await t.run((ctx) => ctx.db.query('leads').collect()))[0];
  const trace = await traceOf(t, lead._id);
  expect(trace.fields).toMatchObject({
    firstName: 'Ada',
    lastName: '',
    email: 'ada@example.com',
    marketingConsent: ['email'],
    consentUpdatedAt: SUBMITTED,
    consentSource: 'form',
    ownerIds: [],
    isRedFlagged: false,
    lifecycleStage: 'lead',
    formSubmissionCount: 1,
    lastActivityAt: SUBMITTED,
    updatedAt: SUBMITTED,
  });
  expect(trace.fields.createdBy).toBeUndefined();
  expect(trace.token).toMatch(TOKEN);
  expect(trace.audits.filter((a) => a.action === 'create')).toEqual([
    {
      action: 'create',
      userId: undefined,
      apiKeyId: undefined,
      metadata: { source: 'form', formId },
    },
  ]);
  expect(trace.history).toEqual([
    { from: undefined, to: 'lead', source: 'form', changedBy: undefined },
  ]);
  // The workflow asking for a submission sees it: the count is stamped before `lead_created` goes out.
  expect(trace.runs.sort()).toEqual([afterForm, everyone].sort());
});

test('a contact is created in one place', () => {
  const root = join(import.meta.dir, '../../convex');
  const sourcesOf = (dir: string): string[] =>
    readdirSync(join(root, dir), { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return entry.name === '_generated' ? [] : sourcesOf(path);
      return entry.name.endsWith('.ts') ? [path] : [];
    });
  const inserting = sourcesOf('.').filter((path) =>
    /insert\(\s*'leads'/.test(readFileSync(join(root, path), 'utf8')),
  );
  expect(inserting).toEqual(['lib/leads/records.ts']);
});
