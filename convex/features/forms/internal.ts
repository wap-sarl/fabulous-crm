import { v } from 'convex/values';
import type { Doc, Id } from '../../_generated/dataModel';
import { internalQuery } from '../../_generated/server';
// Trigger-wrapped constructor: lead writes must run the lead triggers (functions.ts).
import { internalMutation } from '../../_lib/functions';
import { MAX_FILL_MS, MIN_FILL_MS, formFieldKey } from '../../_lib/validators/forms';
import { propertyValueValidator, type PropertyValue } from '../../_lib/validators/properties';
import { generateHexToken } from '../../lib/crypto';
import { filterUndefined } from '../../lib/dbHelpers';
import {
  buildPublicForm,
  cleanSubmissionValues,
  ensureVisitorToken,
  leadOfVisitorToken,
  loadLiveForm,
  resolveFormCompany,
} from '../../lib/forms';
import { stampLeadSignal } from '../../lib/leadSignals';
import { insertLifecycleHistory, loadLifecycleConfig } from '../../lib/lifecycle';
import { loadPropertyDefsById } from '../../lib/properties';
import { normalizeEmail } from '../crm/mutations';
import { diffLeadFilterFields } from '../workflows/lib';
import { dispatchWorkflowTrigger, loadActiveWorkflows } from '../workflows/triggerDispatch';

const CONSENT_TOKEN_BYTES = 24;

/** The public render payload of one active form (null hides which ids exist). */
export const getPublicForm = internalQuery({
  args: { formId: v.string(), visitorToken: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const formId = ctx.db.normalizeId('forms', args.formId);
    const form = formId ? await loadLiveForm(ctx, formId) : null;
    if (!form) return null;
    const defsById = await loadPropertyDefsById(ctx, 'lead');
    const visitorLead = await leadOfVisitorToken(ctx, args.visitorToken);
    return { ...buildPublicForm(form, defsById, visitorLead), ts: Date.now() };
  },
});

export const submitForm = internalMutation({
  args: {
    formId: v.string(),
    values: v.record(v.string(), propertyValueValidator),
    consent: v.boolean(),
    honeypot: v.optional(v.string()),
    // The `ts` handed out by getPublicForm — minimum-fill-time bot check.
    renderedAt: v.optional(v.number()),
    visitorToken: v.optional(v.string()),
    ipHash: v.string(),
    userAgent: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const formId = ctx.db.normalizeId('forms', args.formId);
    const form = formId ? await loadLiveForm(ctx, formId) : null;
    if (!form) return { ok: false as const, code: 'not_found' as const };

    // Honeypot filled = bot. Pretend success so the bot learns nothing.
    if (args.honeypot) return { ok: true as const, afterSubmit: form.afterSubmit };

    const age = args.renderedAt === undefined ? -1 : Date.now() - args.renderedAt;
    if (age < MIN_FILL_MS || age > MAX_FILL_MS) {
      return { ok: false as const, code: 'too_fast' as const };
    }
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
    const emailMatch = email
      ? await ctx.db
          .query('leads')
          .withIndex('by_email', (q) => q.eq('email', email))
          .first()
      : null;
    // A different email typed on a known browser = someone else: never patch
    // the visitor's lead with another person's submission.
    const visitorUsable =
      visitorLead && (!email || !visitorLead.email || visitorLead.email === email);
    const existing = emailMatch ?? (visitorUsable ? visitorLead : null);

    const now = Date.now();
    let leadId: Id<'leads'>;
    if (existing) {
      leadId = existing._id;
      const updates: Record<string, unknown> = filterUndefined({
        firstName: standard.firstName,
        lastName: standard.lastName,
        email,
        phone: standard.phone,
        comment: standard.comment,
      });
      if (Object.keys(custom).length > 0) {
        updates.customProperties = { ...existing.customProperties, ...custom };
      }
      if (standard.company) {
        updates.companyId = await resolveFormCompany(ctx, standard.company, email);
      }
      const patch: Record<string, unknown> = { ...updates, updatedAt: now };
      // Revive a soft-deleted lead (patching undefined removes the field).
      if (existing.deletedAt != null) patch.deletedAt = undefined;
      await ctx.db.patch(existing._id, patch);
      const changedFields = diffLeadFilterFields(existing, updates);
      if (changedFields.length > 0) {
        await dispatchWorkflowTrigger(
          ctx,
          existing._id,
          { type: 'lead_property_changed', changedFields },
          { workflows },
        );
      }
      if (!existing.marketingConsent.includes('email')) {
        await ctx.db.patch(existing._id, {
          marketingConsent: [...existing.marketingConsent, 'email'],
          consentUpdatedAt: now,
          consentSource: 'form',
        });
        await dispatchWorkflowTrigger(
          ctx,
          existing._id,
          { type: 'consent_updated' },
          { workflows },
        );
      }
    } else {
      const lifecycle = await loadLifecycleConfig(ctx);
      const companyId = standard.company
        ? await resolveFormCompany(ctx, standard.company, email)
        : undefined;
      leadId = await ctx.db.insert('leads', {
        firstName: standard.firstName ?? '',
        lastName: standard.lastName ?? '',
        email,
        phone: standard.phone,
        comment: standard.comment,
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
      await insertLifecycleHistory(
        ctx,
        leadId,
        { from: undefined, to: lifecycle.defaultStage },
        { source: 'form' },
      );
      await dispatchWorkflowTrigger(ctx, leadId, { type: 'lead_created' }, { workflows });
    }

    // Only the accepted values are logged, keyed like the public definition.
    const storedValues: Record<string, PropertyValue> = {};
    for (const field of form.fields) {
      const key = formFieldKey(field.target);
      const value =
        field.target.kind === 'custom'
          ? custom[field.target.propertyDefId]
          : standard[field.target.field];
      if (value !== undefined) storedValues[key] = value;
    }
    await ctx.db.insert('formSubmissions', {
      formId: form._id,
      leadId,
      values: storedValues,
      ipHash: args.ipHash,
      userAgent: args.userAgent,
    });
    await stampLeadSignal(ctx, leadId, 'form_submission', now);
    await dispatchWorkflowTrigger(
      ctx,
      leadId,
      { type: 'form_submitted', formId: form._id },
      { workflows },
    );

    return {
      ok: true as const,
      afterSubmit: form.afterSubmit,
      visitorToken: await ensureVisitorToken(ctx, leadId),
    };
  },
});

export type SubmitFormResult =
  | { ok: false; code: 'not_found' | 'too_fast' | 'consent_required' }
  | { ok: false; code: 'invalid_fields'; errors: Record<string, string> }
  | { ok: true; afterSubmit: Doc<'forms'>['afterSubmit']; visitorToken?: string };
