import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Doc, Id } from '@crm/lib/backend';
import { DEFAULT_COUNTRY, registrationSchemeFor } from '@crm/lib/backend';
import {
  AddressInput,
  Button,
  Combobox,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  HelperText,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  createBanAddressProvider,
  toast,
  type AddressValue,
  type SiretCompanyData,
} from '@crm/design-system';
import { COUNTRIES, countryName } from '../../../lib/countries';
import {
  COMPANY_REGISTRATION_INPUT,
  CountryInput,
  resolveCountryInput,
  type CompanyRegistrationContext,
} from '../../../lib/countryInputs';
import { useLifecycleConfig } from '../../leads/hooks/useLifecycleConfig';
import { companyErrorMessage, useCompanyActions } from '../hooks/useCompanyActions';

interface CompanyFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  company?: Doc<'companies'>;
  /** Called with the new id after a successful creation. */
  onCreated?: (companyId: Id<'companies'>) => void;
}

interface FormState {
  name: string;
  country: string;
  registrationNumber: string;
  domain: string;
  website: string;
  sector: string;
  headcount: string;
  lifecycleStage: string;
  address: AddressValue;
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
    name: '',
    country: DEFAULT_COUNTRY,
    registrationNumber: '',
    domain: '',
    website: '',
    sector: '',
    headcount: '',
    lifecycleStage: '',
    address: EMPTY_ADDRESS,
  };
}

function fromCompany(company: Doc<'companies'>): FormState {
  return {
    name: company.name,
    country: company.country,
    registrationNumber: company.registrationNumber ?? '',
    domain: company.domain ?? '',
    website: company.website ?? '',
    sector: company.sector ?? '',
    headcount: company.headcount !== undefined ? String(company.headcount) : '',
    lifecycleStage: company.lifecycleStage ?? '',
    address: {
      streetNumber: company.address?.streetNumber ?? '',
      street: company.address?.street ?? '',
      postalCode: company.address?.postalCode ?? '',
      city: company.address?.city ?? '',
      country: company.address?.country ?? countryName(company.country),
    },
  };
}

const hasAddress = (a: AddressValue) => !!(a.street && a.postalCode && a.city);

/**
 * Create / edit a company. The registration-number field is country-aware:
 * the `CountryInput` registry renders the SIRET input (with the Sirene
 * lookup and a one-click prefill of name + address) for France and a plain
 * input elsewhere — see src/lib/countryInputs.
 */
export function CompanyFormDialog({
  open,
  onOpenChange,
  company,
  onCreated,
}: CompanyFormDialogProps) {
  const isEdit = !!company;
  const { createCompany, updateCompany } = useCompanyActions();
  const lifecycle = useLifecycleConfig();
  const addressProvider = useMemo(() => createBanAddressProvider(), []);

  const [form, setForm] = useState<FormState>(emptyForm);
  const [submitting, setSubmitting] = useState(false);
  const [registryData, setRegistryData] = useState<SiretCompanyData | null>(null);

  useEffect(() => {
    if (open) {
      setForm(company ? fromCompany(company) : emptyForm());
      setRegistryData(null);
    }
  }, [open, company]);

  const setField = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const scheme = registrationSchemeFor(form.country);
  const registration = resolveCountryInput(COMPANY_REGISTRATION_INPUT, form.country);
  const registrationError = form.registrationNumber
    ? scheme.validate(scheme.normalize(form.registrationNumber))
    : null;
  const currentStageIndex = isEdit ? lifecycle.indexOf(company?.lifecycleStage) : -1;

  const onRegistryData = useCallback((data: SiretCompanyData) => setRegistryData(data), []);
  const registrationContext = useMemo<CompanyRegistrationContext>(
    () => ({
      compareTo: {
        streetNumber: form.address.streetNumber,
        street: form.address.street,
        postalCode: form.address.postalCode,
        city: form.address.city,
      },
      onRegistryData,
    }),
    [form.address, onRegistryData],
  );

  const applyRegistryData = () => {
    if (!registryData) return;
    const name = registryData.denomination ?? '';
    const a = registryData.address;
    setForm((prev) => ({
      ...prev,
      name: prev.name || name,
      address: a
        ? {
            streetNumber: a.numeroVoie ?? '',
            street: [a.typeVoie, a.libelleVoie].filter(Boolean).join(' '),
            postalCode: a.codePostal ?? '',
            city: a.libelleCommune ?? '',
            country: 'France',
            countryCode: 'FR',
          }
        : prev.address,
    }));
  };

  const handleSubmit = async () => {
    if (!form.name.trim()) {
      toast.error('Le nom de l’entreprise est requis.');
      return;
    }
    if (registrationError) {
      toast.error(registrationError);
      return;
    }
    const headcount = form.headcount.trim() === '' ? undefined : Number(form.headcount);
    if (headcount !== undefined && (!Number.isInteger(headcount) || headcount < 0)) {
      toast.error('Effectif invalide.');
      return;
    }
    const a = form.address;
    const payload = {
      name: form.name,
      country: form.country,
      // Empty strings reach the server as "clear this field".
      registrationNumber: form.registrationNumber,
      domain: form.domain,
      website: form.website,
      sector: form.sector,
      headcount,
      address: hasAddress(a)
        ? {
            streetNumber: a.streetNumber.trim(),
            street: a.street.trim(),
            postalCode: a.postalCode.trim(),
            city: a.city.trim(),
            country: a.country.trim() || countryName(form.country),
            countryCode: a.countryCode,
          }
        : undefined,
      lifecycleStage: form.lifecycleStage || undefined,
    };

    setSubmitting(true);
    try {
      if (isEdit && company) {
        await updateCompany({ companyId: company._id, ...payload });
        toast.success('Entreprise mise à jour.');
      } else {
        const id = await createCompany(payload);
        toast.success('Entreprise créée.');
        onCreated?.(id);
      }
      onOpenChange(false);
    } catch (e) {
      toast.error(companyErrorMessage(e, 'Une erreur est survenue.'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Modifier l’entreprise' : 'Nouvelle entreprise'}</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="company-name">Nom *</Label>
            <Input
              id="company-name"
              value={form.name}
              onChange={(e) => setField('name', e.target.value)}
              data-testid="company-name"
            />
          </div>

          <div className="space-y-1">
            <Label>Pays</Label>
            <Combobox
              items={COUNTRIES.map((c) => ({ value: c.code, label: c.name }))}
              value={form.country}
              onValueChange={(code) => {
                // The registration scheme changes with the country: a number
                // typed for another scheme would be meaningless, so it resets.
                setForm((prev) => ({ ...prev, country: code, registrationNumber: '' }));
                setRegistryData(null);
              }}
              placeholder="Pays"
              searchPlaceholder="Rechercher un pays…"
              modal
              className="w-full"
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="company-registration">{registration.label ?? scheme.label}</Label>
            <CountryInput
              inputType={COMPANY_REGISTRATION_INPUT}
              country={form.country}
              id="company-registration"
              value={form.registrationNumber}
              onChange={(v) => {
                setField('registrationNumber', v);
                setRegistryData(null);
              }}
              invalid={!!registrationError}
              placeholder={scheme.placeholder}
              context={registrationContext}
            />
            {registration.helperText && !registryData ? (
              <HelperText>{registration.helperText}</HelperText>
            ) : null}
            {registryData ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={applyRegistryData}
                data-testid="apply-registry-data"
              >
                Reprendre le nom et l’adresse du registre
              </Button>
            ) : null}
          </div>

          <div className="space-y-1">
            <Label htmlFor="company-domain">Domaine</Label>
            <Input
              id="company-domain"
              value={form.domain}
              onChange={(e) => setField('domain', e.target.value)}
              placeholder="acme.fr"
            />
            <HelperText>
              Les leads dont l’e-mail porte ce domaine sont rattachés automatiquement.
            </HelperText>
          </div>
          <div className="space-y-1">
            <Label htmlFor="company-website">Site web</Label>
            <Input
              id="company-website"
              type="url"
              value={form.website}
              onChange={(e) => setField('website', e.target.value)}
              placeholder="https://www.acme.fr"
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="company-sector">Secteur</Label>
            <Input
              id="company-sector"
              value={form.sector}
              onChange={(e) => setField('sector', e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="company-headcount">Effectif</Label>
            <Input
              id="company-headcount"
              type="number"
              min={0}
              value={form.headcount}
              onChange={(e) => setField('headcount', e.target.value)}
            />
          </div>

          <div className="space-y-1 sm:col-span-2">
            <Label>Cycle de vie</Label>
            <Select
              value={form.lifecycleStage || '__none__'}
              onValueChange={(v) => setField('lifecycleStage', v === '__none__' ? '' : v)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">—</SelectItem>
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
        </div>

        <fieldset className="space-y-2 rounded-md border border-border p-3">
          <AddressInput
            idPrefix="company"
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

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>
            Annuler
          </Button>
          <Button onClick={handleSubmit} loading={submitting} data-testid="submit-company">
            {isEdit ? 'Enregistrer' : 'Créer'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
