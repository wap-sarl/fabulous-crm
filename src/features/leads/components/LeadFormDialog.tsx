import { useState, useEffect, useMemo } from 'react';
import type { Id, LeadStatus, LeadPropertyValue } from '@crm/lib/backend';
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
  AddressInput,
  createBanAddressProvider,
  toast,
  type AddressValue,
} from '@crm/design-system';
import { useEmployees } from '../../../lib/hooks/useEmployees';
import { LEAD_STATUSES } from '../../../lib/constants';
import { useLeadActions } from '../hooks/useLeadActions';
import { useLeadPropertyDefinitions } from '../hooks/useLeadPropertyDefinitions';
import { validateLeadPropertyValue } from '../lib/customProperties';
import { LeadCustomPropertyFields } from './LeadCustomPropertyFields';
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
  status: LeadStatus;
  assignedTo: string;
  isRedFlagged: boolean;
  comment: string;
  address: AddressValue;
  customProperties: Record<string, LeadPropertyValue>;
}

const EMPTY_ADDRESS: AddressValue = {
  streetNumber: '',
  street: '',
  postalCode: '',
  city: '',
  country: 'France',
};

function emptyForm(): FormState {
  return {
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    status: 'nouveau',
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
    status: lead.status,
    assignedTo: lead.assignedTo ?? '',
    isRedFlagged: lead.isRedFlagged,
    comment: lead.comment ?? '',
    address: {
      streetNumber: lead.address?.streetNumber ?? '',
      street: lead.address?.street ?? '',
      postalCode: lead.address?.postalCode ?? '',
      city: lead.address?.city ?? '',
      country: lead.address?.country ?? 'France',
    },
    customProperties: { ...(lead.customProperties ?? {}) },
  };
}

export function LeadFormDialog({ open, onOpenChange, lead }: LeadFormDialogProps) {
  const isEdit = !!lead;
  const { employees } = useEmployees();
  const { createLead, updateLead } = useLeadActions();
  const propertyDefinitions = useLeadPropertyDefinitions();

  // French BAN address autocomplete — keyless government API, no env var needed.
  const addressProvider = useMemo(() => createBanAddressProvider(), []);

  const [form, setForm] = useState<FormState>(emptyForm);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) setForm(lead ? fromLead(lead) : emptyForm());
  }, [open, lead]);

  const setField = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const setCustomProp = (definitionId: string, value: LeadPropertyValue | undefined) =>
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
      (def) => validateLeadPropertyValue(def, form.customProperties[def._id]) !== null
    );
    if (invalid) {
      toast.error('Certaines propriétés personnalisées sont invalides.');
      return;
    }

    const a = form.address;
    const hasAddress = a.streetNumber && a.street && a.postalCode && a.city;
    const address = hasAddress
      ? {
          streetNumber: a.streetNumber.trim(),
          street: a.street.trim(),
          postalCode: a.postalCode.trim(),
          city: a.city.trim(),
          country: a.country.trim() || 'France',
        }
      : undefined;

    const payload = {
      firstName: form.firstName,
      lastName: form.lastName,
      email: form.email || undefined,
      phone: form.phone || undefined,
      address,
      status: form.status,
      assignedTo: form.assignedTo ? (form.assignedTo as Id<'users'>) : undefined,
      isRedFlagged: form.isRedFlagged,
      comment: form.comment || undefined,
      customProperties: form.customProperties,
    };

    setSubmitting(true);
    try {
      if (isEdit && lead) {
        await updateLead({ leadId: lead._id, ...payload });
        toast.success('Lead mis à jour.');
      } else {
        await createLead(payload);
        toast.success('Lead créé.');
      }
      onOpenChange(false);
    } catch {
      toast.error('Une erreur est survenue.');
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
            <Select value={form.status} onValueChange={(v) => setField('status', v as LeadStatus)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LEAD_STATUSES.map((s) => (
                  <SelectItem key={s.value} value={s.value}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
          <AddressInput
            idPrefix="lead"
            value={form.address}
            onChange={(v) => setField('address', v)}
            fetchSuggestions={addressProvider.fetchSuggestions}
            resolveDetails={addressProvider.resolveDetails}
            labels={{
              streetNumber: 'N°',
              street: 'Rue',
              postalCode: 'Code postal',
              city: 'Ville',
              country: 'Pays',
            }}
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

        <LeadCustomPropertyFields
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
