import { useState, useEffect } from 'react';
import type { Id, PropertyValue } from '@crm/lib/backend';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  Button,
  Input,
  Label,
  Textarea,
  Combobox,
  Checkbox,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  PhoneInput,
  EmailInput,
  validateEmail,
  toast,
  type AddressValue,
} from '@crm/design-system';
import { useEmployees } from '../../../lib/hooks/useEmployees';
import { useLeadActions } from '../hooks/useLeadActions';
import { usePropertyDefinitions } from '../../properties/hooks/usePropertyDefinitions';
import { useLifecycleConfig } from '../hooks/useLifecycleConfig';
import { CompanyPicker } from '../../companies/components/CompanyPicker';
import { HelperText } from '@crm/design-system';
import { DEFAULT_COUNTRY, validateAddress } from '@crm/lib/backend';
import { CountryAddressInput } from '../../../lib/countryInputs';
import { validatePropertyValue } from '../../properties/lib/customProperties';
import { CustomPropertyFields } from '../../properties/components/CustomPropertyFields';
import type { LeadRow } from '../types';

interface LeadFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lead?: LeadRow;
}

interface FormState {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  /** '' = the configured default stage (create only). */
  lifecycleStage: string;
  /** '' = none; on create the server may still match one from the email domain. */
  companyId: Id<'companies'> | '';
  assignedTo: string;
  isRedFlagged: boolean;
  comment: string;
  address: AddressValue;
  customProperties: Record<string, PropertyValue>;
}

const EMPTY_ADDRESS: AddressValue = {
  country: DEFAULT_COUNTRY,
  streetNumber: '',
  street: '',
  postalCode: '',
  city: '',
};

function emptyForm(): FormState {
  return {
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    lifecycleStage: '',
    companyId: '',
    assignedTo: '',
    isRedFlagged: false,
    comment: '',
    address: EMPTY_ADDRESS,
    customProperties: {},
  };
}

function fromLead(lead: LeadRow): FormState {
  return {
    firstName: lead.firstName,
    lastName: lead.lastName,
    email: lead.email ?? '',
    phone: lead.phone ?? '',
    lifecycleStage: lead.lifecycleStage ?? '',
    companyId: lead.companyId ?? '',
    assignedTo: lead.assignedTo ?? '',
    isRedFlagged: lead.isRedFlagged,
    comment: lead.comment ?? '',
    address: {
      country: lead.address?.country ?? DEFAULT_COUNTRY,
      streetNumber: lead.address?.streetNumber ?? '',
      street: lead.address?.street ?? '',
      line2: lead.address?.line2,
      postalCode: lead.address?.postalCode ?? '',
      city: lead.address?.city ?? '',
      region: lead.address?.region,
    },
    customProperties: { ...(lead.customProperties ?? {}) },
  };
}

export function LeadFormDialog({ open, onOpenChange, lead }: LeadFormDialogProps) {
  const isEdit = !!lead;
  const { employees } = useEmployees();
  const { createLead, updateLead } = useLeadActions();
  const propertyDefinitions = usePropertyDefinitions('lead');
  const lifecycle = useLifecycleConfig();
  const currentStageIndex = isEdit ? lifecycle.indexOf(lead?.lifecycleStage) : -1;

  const [form, setForm] = useState<FormState>(emptyForm);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) setForm(lead ? fromLead(lead) : emptyForm());
  }, [open, lead]);

  const setField = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const setCustomProp = (definitionId: string, value: PropertyValue | undefined) =>
    setForm((prev) => {
      const next = { ...prev.customProperties };
      if (value === undefined) delete next[definitionId];
      else next[definitionId] = value;
      return { ...prev, customProperties: next };
    });

  const handleSubmit = async () => {
    if (!form.firstName.trim() || !form.lastName.trim()) {
      toast.error('Le prénom et le nom sont requis.');
      return;
    }

    // Block on any invalid custom-property value (email/number/text rules).
    const invalid = propertyDefinitions.some(
      (def) => validatePropertyValue(def, form.customProperties[def._id]) !== null,
    );
    if (invalid) {
      toast.error('Certaines propriétés personnalisées sont invalides.');
      return;
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
        return;
      }
    }

    const payload = {
      firstName: form.firstName,
      lastName: form.lastName,
      email: form.email || undefined,
      phone: form.phone || undefined,
      address,
      lifecycleStage: form.lifecycleStage || undefined,
      assignedTo: form.assignedTo ? (form.assignedTo as Id<'users'>) : undefined,
      isRedFlagged: form.isRedFlagged,
      comment: form.comment || undefined,
      customProperties: form.customProperties,
    };

    setSubmitting(true);
    try {
      if (isEdit && lead) {
        await updateLead({ leadId: lead._id, ...payload, companyId: form.companyId || null });
        toast.success('Lead mis à jour.');
      } else {
        await createLead({ ...payload, companyId: form.companyId || undefined });
        toast.success('Lead créé.');
      }
      onOpenChange(false);
    } catch (e) {
      const message = e instanceof Error ? e.message : '';
      toast.error(
        message.includes('lifecycle_regression_blocked')
          ? 'Le retour à un statut antérieur est désactivé (Paramètres → Statuts).'
          : 'Une erreur est survenue.',
      );
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
          <div className="space-y-1">
            <Label htmlFor="firstName">Prénom *</Label>
            <Input
              id="firstName"
              value={form.firstName}
              onChange={(e) => setField('firstName', e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="lastName">Nom *</Label>
            <Input
              id="lastName"
              value={form.lastName}
              onChange={(e) => setField('lastName', e.target.value)}
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="email">E-mail</Label>
            <EmailInput
              id="email"
              value={form.email}
              onChange={(e) => setField('email', e.target.value)}
              error={form.email ? validateEmail(form.email) : null}
            />
          </div>
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
              onChange={(v) => setField('companyId', v)}
              selectedName={lead?.companyName ?? null}
              modal
            />
            {!isEdit && !form.companyId ? (
              <HelperText>
                Laissez vide pour rattacher automatiquement une entreprise existante portant le
                domaine de l’e-mail.
              </HelperText>
            ) : null}
          </div>
          <div className="space-y-1">
            <Label>Assigné à</Label>
            <Combobox
              items={[
                { value: '', label: 'Non assigné' },
                ...employees.map((e) => ({
                  value: e._id,
                  label: `${e.firstName} ${e.lastName}`,
                })),
              ]}
              value={form.assignedTo}
              onValueChange={(v) => setField('assignedTo', v)}
              placeholder="Non assigné"
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
    </Dialog>
  );
}
