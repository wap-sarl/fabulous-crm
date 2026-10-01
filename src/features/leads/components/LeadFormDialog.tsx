import { useState, useEffect } from 'react';
import { useConvex } from 'convex/react';
import { describeError, errorText } from '@crm/lib/errors';
import { api } from '@crm/lib/backend';
import type { Id, PropertyValue } from '@crm/lib/backend';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  Button,
  Label,
  Textarea,
  Checkbox,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  PhoneInput,
  toast,
  MultiSelect,
} from '@crm/design-system';
import { useEmployees } from '../../../lib/hooks/useEmployees';
import { useLeadActions } from '../hooks/useLeadActions';
import { usePropertyDefinitions } from '../../properties/hooks/usePropertyDefinitions';
import { useLifecycleConfig } from '../hooks/useLifecycleConfig';
import { CompanyPicker } from '../../companies/components/CompanyPicker';
import { HelperText } from '@crm/design-system';
import { validateAddress } from '@crm/lib/backend';
import { CountryAddressInput } from '../../../lib/countryInputs';
import { validatePropertyValue } from '../../properties/lib/customProperties';
import { CustomPropertyFields } from '../../properties/components/CustomPropertyFields';
import type { LeadRow } from '../types';
import {
  emptyForm,
  fromLead,
  identitySchema,
  toFieldErrors,
  type FieldErrors,
  type FormState,
  type RequiredField,
} from '../lib/leadForm';
import { LeadIdentityFields } from './LeadIdentityFields';

interface LeadFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lead?: LeadRow;
}

type DomainMatch = { _id: Id<'companies'>; name: string };

export function LeadFormDialog({ open, onOpenChange, lead }: LeadFormDialogProps) {
  const isEdit = !!lead;
  const convex = useConvex();
  const { employees } = useEmployees();
  const { createLead, updateLead } = useLeadActions();
  const propertyDefinitions = usePropertyDefinitions('lead');
  const lifecycle = useLifecycleConfig();
  const currentStageIndex = isEdit ? lifecycle.indexOf(lead?.lifecycleStage) : -1;

  const [form, setForm] = useState<FormState>(emptyForm);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);
  /** Company matched by the email's domain, awaiting the « rattacher ? » answer. */
  const [domainMatch, setDomainMatch] = useState<DomainMatch | null>(null);
  /** Name of the company picked through the prompt (not in the picker's search results). */
  const [pickedCompanyName, setPickedCompanyName] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setForm(lead ? fromLead(lead) : emptyForm());
      setFieldErrors({});
      setDomainMatch(null);
      setPickedCompanyName(null);
    }
  }, [open, lead]);

  const setField = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    // Typing in a flagged field clears its message until the next submit.
    setFieldErrors((prev) => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key as RequiredField];
      return next;
    });
  };

  const setCustomProp = (definitionId: string, value: PropertyValue | undefined) =>
    setForm((prev) => {
      const next = { ...prev.customProperties };
      if (value === undefined) delete next[definitionId];
      else next[definitionId] = value;
      return { ...prev, customProperties: next };
    });

  const buildPayload = () => {
    const identity = identitySchema.safeParse(form);
    setFieldErrors(identity.success ? {} : toFieldErrors(identity.error));
    if (!identity.success) return null;

    // Block on any invalid custom-property value (email/number/text rules).
    const invalid = propertyDefinitions.some(
      (def) => validatePropertyValue(def, form.customProperties[def._id]) !== null,
    );
    if (invalid) {
      toast.error('Certaines propriétés personnalisées sont invalides.');
      return null;
    }

    const a = form.address;
    const hasAddress = !!(a.street || a.postalCode || a.city || a.region);
    const address = hasAddress
      ? {
          country: a.country,
          streetNumber: a.streetNumber.trim(),
          street: a.street.trim(),
          line2: a.line2?.trim() || undefined,
          postalCode: a.postalCode.trim(),
          city: a.city.trim(),
          region: a.region || undefined,
        }
      : undefined;
    if (address) {
      const addressError = validateAddress(address);
      if (addressError) {
        toast.error(`Adresse : ${addressError}`);
        return null;
      }
    }

    return {
      ...identity.data,
      phone: form.phone || undefined,
      address,
      lifecycleStage: form.lifecycleStage || undefined,
      ownerIds: form.ownerIds as Id<'users'>[],
      isRedFlagged: form.isRedFlagged,
      comment: form.comment || undefined,
      customProperties: form.customProperties,
    };
  };

  const save = async (
    payload: NonNullable<ReturnType<typeof buildPayload>>,
    companyId: Id<'companies'> | null,
  ) => {
    if (isEdit && lead) {
      await updateLead({ leadId: lead._id, ...payload, companyId });
      toast.success('Lead mis à jour.');
    } else {
      await createLead({ ...payload, companyId: companyId ?? undefined });
      toast.success('Lead créé.');
    }
    onOpenChange(false);
  };

  const reportError = (e: unknown) => {
    toast.error(
      errorText(e).includes('lifecycle_regression_blocked')
        ? 'Le retour à un statut antérieur est désactivé (Paramètres → Statuts).'
        : describeError(e, 'Une erreur est survenue.'),
    );
  };

  const handleSubmit = async () => {
    const payload = buildPayload();
    if (!payload) return;
    setSubmitting(true);
    try {
      // No company picked: a company known by the email's domain is proposed, never attached on its own, and the save waits for the answer.
      if (!form.companyId && payload.email) {
        const match = await convex.query(api.features.companies.queries.findCompanyByEmailDomain, {
          email: payload.email,
        });
        if (match) {
          setDomainMatch(match);
          return;
        }
      }
      await save(payload, form.companyId || null);
    } catch (e) {
      reportError(e);
    } finally {
      setSubmitting(false);
    }
  };

  /** Oui / Non on the domain prompt. Closing it without answering saves nothing. */
  const answerDomainMatch = async (attach: boolean) => {
    const match = domainMatch;
    setDomainMatch(null);
    const payload = buildPayload();
    if (!match || !payload) return;
    if (attach) {
      setField('companyId', match._id);
      setPickedCompanyName(match.name);
    }
    setSubmitting(true);
    try {
      await save(payload, attach ? match._id : null);
    } catch (e) {
      reportError(e);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Modifier le lead' : 'Nouveau lead'}</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <LeadIdentityFields form={form} setField={setField} fieldErrors={fieldErrors} />
          <div className="space-y-1">
            <Label htmlFor="phone">Téléphone</Label>
            <PhoneInput
              id="phone"
              defaultCountry="FR"
              international
              placeholder="+33 6 12 34 56 78"
              value={form.phone}
              onChange={(v) => setField('phone', v ?? '')}
            />
          </div>

          <div className="space-y-1">
            <Label>Statut</Label>
            <Select
              value={form.lifecycleStage || lifecycle.defaultStage}
              onValueChange={(v) => setField('lifecycleStage', v)}
            >
              <SelectTrigger data-testid="lead-lifecycle-select">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {lifecycle.stages.map((s, index) => (
                  <SelectItem
                    key={s.key}
                    value={s.key}
                    disabled={!lifecycle.allowRegression && index < currentStageIndex}
                  >
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label>Entreprise</Label>
            <CompanyPicker
              value={form.companyId}
              onChange={(v) => {
                setField('companyId', v);
                setPickedCompanyName(null);
              }}
              selectedName={pickedCompanyName ?? lead?.companyName ?? null}
              modal
            />
            {!form.companyId ? (
              <HelperText>
                Si l’e-mail porte le domaine d’une entreprise existante, le rattachement vous sera
                proposé à l’enregistrement.
              </HelperText>
            ) : null}
          </div>
          <div className="space-y-1">
            <Label>Propriétaires</Label>
            <MultiSelect
              items={employees.map((e) => ({
                value: e._id,
                label: `${e.firstName} ${e.lastName}`,
              }))}
              value={form.ownerIds}
              onValueChange={(v) => setField('ownerIds', v)}
              placeholder="Non assigné"
              modal
              className="w-full"
            />
          </div>
        </div>

        <fieldset className="space-y-2 rounded-md border border-border p-3">
          <CountryAddressInput
            idPrefix="lead"
            value={form.address}
            onChange={(v) => setField('address', v)}
          />
        </fieldset>

        <div className="space-y-1">
          <Label htmlFor="comment">Commentaire</Label>
          <Textarea
            id="comment"
            value={form.comment}
            onChange={(e) => setField('comment', e.target.value)}
            rows={3}
          />
        </div>

        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={form.isRedFlagged}
            onCheckedChange={(c) => setField('isRedFlagged', c === true)}
          />
          Marquer comme signalé (red flag)
        </label>

        <CustomPropertyFields
          definitions={propertyDefinitions}
          values={form.customProperties}
          onChange={setCustomProp}
          firstName={form.firstName}
          lastName={form.lastName}
        />

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>
            Annuler
          </Button>
          <Button onClick={handleSubmit} loading={submitting}>
            {isEdit ? 'Enregistrer' : 'Créer'}
          </Button>
        </DialogFooter>
      </DialogContent>

      <Dialog open={domainMatch !== null} onOpenChange={(next) => !next && setDomainMatch(null)}>
        <DialogContent className="sm:max-w-md" data-testid="domain-match-dialog">
          <DialogHeader>
            <DialogTitle>Rattacher à une entreprise ?</DialogTitle>
            <DialogDescription>
              Une entreprise avec le même domaine existe :{' '}
              <span className="font-medium text-ink">{domainMatch?.name}</span>. Rattacher ce lead à
              cette entreprise ?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => answerDomainMatch(false)}
              disabled={submitting}
              data-testid="domain-match-no"
            >
              Non
            </Button>
            <Button
              onClick={() => answerDomainMatch(true)}
              loading={submitting}
              data-testid="domain-match-yes"
            >
              Oui
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Dialog>
  );
}
