import { v } from 'convex/values';
import { internal } from '../../_generated/api';
import type { Doc, Id } from '../../_generated/dataModel';
import { internalQuery } from '../../_generated/server';
// Trigger-wrapped constructor: lead writes must run the lead triggers (functions.ts).
import { internalMutation } from '../../_lib/functions';
import { MAX_FILL_MS, MIN_FILL_MS } from '../../_lib/validators/forms';
import { propertyValueValidator, type PropertyValue } from '../../_lib/validators/properties';
import { computeChanges, logAudit } from '../../lib/audit';
import { generateHexToken } from '../../lib/crypto';
import {
  buildPublicForm,
  cleanSubmissionValues,
  companyOfSubmission,
  decoyVisitorToken,
  ensureVisitorToken,
  fillableUpdates,
  findLiveLeadByEmail,
  hasEmailField,
  initialComment,
  leadOfVisitorToken,
  loadLiveForm,
  signRender,
  verifyRender,
} from '../../lib/forms';
import { gateLeadCreate } from '../../lib/gates';
import { normalizeEmail } from '../../lib/leadImport';
import { stampLeadSignal } from '../../lib/leadSignals';
import { insertLifecycleHistory, loadLifecycleConfig } from '../../lib/lifecycle';
import { loadPropertyDefsById } from '../../lib/properties';
import { dispatchWorkflowTrigger, loadActiveWorkflows } from '../workflows/triggerDispatch';

const CONSENT_TOKEN_BYTES = 24;

/** The public render payload of one active form (null hides which ids exist), with its signed render stamp. */
export const getPublicForm = internalQuery({
  args: { formId: v.string(), visitorToken: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const formId = ctx.db.normalizeId('forms', args.formId);
    const form = formId ? await loadLiveForm(ctx, formId) : null;
    if (!form) return null;
    const defsById = await loadPropertyDefsById(ctx, 'lead');
    const visitorLead = await leadOfVisitorToken(ctx, args.visitorToken);
    const ts = Date.now();
    return {
      ...buildPublicForm(form, defsById, visitorLead),
      ts,
      sig: await signRender(form._id, ts),
    };
  },
});

/*
 * What a public submission may do, the address being nobody's proof of anything:
 * - an unknown e-mail (or none) creates a contact, with the e-mail consent the person ticked (single opt-in);
 * - a known live contact is only completed: empty fields filled, nothing overwritten, no consent recorded, no
 *   property or consent trigger; `form_submitted` is the one trigger a form fires on it, and the submission
 *   counter moves only when the browser is the one that created the contact (its visitor token);
 * - a deleted contact is a stranger: a new one is created, the deleted stays in the trash.
 */
export const submitForm = internalMutation({
  args: {
    formId: v.string(),
    values: v.record(v.string(), propertyValueValidator),
    consent: v.boolean(),
    honeypot: v.optional(v.string()),
    // The `ts` and `sig` handed out by getPublicForm — minimum-fill-time bot check.
    renderedAt: v.optional(v.number()),
    renderSig: v.optional(v.string()),
    visitorToken: v.optional(v.string()),
    // The tracking script's cookie id, to tie the browser's page views to the contact (named mode).
    trackingVisitor: v.optional(v.string()),
    ipHash: v.string(),
    userAgent: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const formId = ctx.db.normalizeId('forms', args.formId);
    const form = formId ? await loadLiveForm(ctx, formId) : null;
    if (!form) return { ok: false as const, code: 'not_found' as const };

    // Honeypot filled = bot. Pretend success, token included, so the bot learns nothing.
    if (args.honeypot) {
      return {
        ok: true as const,
        afterSubmit: form.afterSubmit,
        visitorToken: decoyVisitorToken(),
      };
    }

    const stamped =
      args.renderedAt !== undefined &&
      args.renderSig !== undefined &&
      (await verifyRender(form._id, args.renderedAt, args.renderSig));
    const age = stamped && args.renderedAt !== undefined ? Date.now() - args.renderedAt : -1;
    if (age < MIN_FILL_MS) return { ok: false as const, code: 'too_fast' as const };
    // A page left open for a day: the embed fetches a fresh definition and tries again.
    if (age > MAX_FILL_MS) return { ok: false as const, code: 'stale' as const };
    if (!args.consent) return { ok: false as const, code: 'consent_required' as const };

    const defsById = await loadPropertyDefsById(ctx, 'lead');
    const visitorLead = await leadOfVisitorToken(ctx, args.visitorToken);
    const { standard, custom, errors } = cleanSubmissionValues(
      form,
      defsById,
      args.values,
      visitorLead,
    );
    if (Object.keys(errors).length > 0) {
      return { ok: false as const, code: 'invalid_fields' as const, errors };
    }

    const workflows = await loadActiveWorkflows(ctx);
    const email = normalizeEmail(standard.email);
    const emailMatch = email ? await findLiveLeadByEmail(ctx, email) : null;
    // The browser's token names a contact only on a form that asks for an e-mail (a skipped one is a known one),
    // and never against another address: a shared computer or a stranger typing is someone else.
    const visitorUsable =
      !!visitorLead &&
      hasEmailField(form) &&
      (!email || !visitorLead.email || visitorLead.email === email);
    const existing = emailMatch ?? (visitorUsable ? visitorLead : null);
    const companyId = await companyOfSubmission(ctx, email);

    const now = Date.now();
    let leadId: Id<'leads'>;
    if (existing) {
      leadId = existing._id;
      const updates = fillableUpdates(existing, standard, custom, companyId);
      const changes = computeChanges(existing, updates);
      if (changes) {
        await ctx.db.patch(existing._id, { ...updates, updatedAt: now });
        await logAudit({
          ctx,
          entityType: 'lead',
          entityId: existing._id,
          action: 'update',
          metadata: { source: 'form', formId: form._id, changes },
        });
      }
      // The counter is behaviour: only the browser that created the contact may move it.
      if (visitorLead?._id === existing._id) {
        await stampLeadSignal(ctx, existing._id, 'form_submission', now);
      }
    } else {
      // A contact becoming live goes through the seam like every other creation; a refusal is not the visitor's business.
      try {
        await gateLeadCreate(ctx, 1, 'form');
      } catch {
        return { ok: false as const, code: 'unavailable' as const };
      }
      const lifecycle = await loadLifecycleConfig(ctx);
      leadId = await ctx.db.insert('leads', {
        firstName: standard.firstName ?? '',
        lastName: standard.lastName ?? '',
        email,
        phone: standard.phone,
        comment: initialComment(standard, companyId !== undefined),
        // Single opt-in: the box the person ticked, on the contact this submission creates and on no other.
        marketingConsent: ['email'],
        consentUpdatedAt: now,
        consentSource: 'form',
        consentToken: generateHexToken(CONSENT_TOKEN_BYTES),
        ownerIds: [],
        companyId,
        isRedFlagged: false,
        lifecycleStage: lifecycle.defaultStage,
        customProperties: Object.keys(custom).length > 0 ? custom : undefined,
        updatedAt: now,
      });
      await logAudit({
        ctx,
        entityType: 'lead',
        entityId: leadId,
        action: 'create',
        metadata: { source: 'form', formId: form._id },
      });
      await insertLifecycleHistory(
        ctx,
        leadId,
        { from: undefined, to: lifecycle.defaultStage },
        { source: 'form' },
      );
      await stampLeadSignal(ctx, leadId, 'form_submission', now);
      await dispatchWorkflowTrigger(ctx, leadId, { type: 'lead_created' }, { workflows });
    }

    // Only the accepted values are logged, keyed like the public definition.
    const storedValues: Record<string, PropertyValue> = {};
    for (const field of form.fields) {
      const value =
        field.target.kind === 'custom'
          ? custom[field.target.propertyDefId]
          : standard[field.target.field];
      if (value !== undefined) storedValues[field.key] = value;
    }
    await ctx.db.insert('formSubmissions', {
      formId: form._id,
      leadId,
      values: storedValues,
      ipHash: args.ipHash,
      userAgent: args.userAgent,
    });
    await dispatchWorkflowTrigger(
      ctx,
      leadId,
      { type: 'form_submitted', formId: form._id },
      { workflows },
    );
    if (args.trackingVisitor) {
      await ctx.scheduler.runAfter(0, internal.features.tracking.internal.identifyVisitor, {
        visitorId: args.trackingVisitor,
        leadId,
      });
    }

    return {
      ok: true as const,
      afterSubmit: form.afterSubmit,
      visitorToken: await ensureVisitorToken(ctx, leadId),
    };
  },
});

export type SubmitFormResult =
  | { ok: false; code: 'not_found' | 'too_fast' | 'stale' | 'consent_required' | 'unavailable' }
  | { ok: false; code: 'invalid_fields'; errors: Record<string, string> }
  | { ok: true; afterSubmit: Doc<'forms'>['afterSubmit']; visitorToken?: string };
