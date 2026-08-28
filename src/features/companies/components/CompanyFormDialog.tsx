import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Doc, Id } from '@crm/lib/backend';
import {
  DEFAULT_COUNTRY,
  registrationSchemeFor,
  validateAddress,
  vatSchemeFor,
} from '@crm/lib/backend';
import {
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
  toast,
  type AddressValue,
  type SiretCompanyData,
  MultiSelect,
} from '@crm/design-system';
import { COUNTRIES, countryName } from '../../../lib/countries';
import {
  COMPANY_REGISTRATION_INPUT,
  COMPANY_VAT_INPUT,
  CountryAddressInput,
  CountryInput,
  resolveCountryInput,
  type CompanyRegistrationContext,
  type CompanyVatContext,
} from '../../../lib/countryInputs';
import type { PropertyValue } from '@crm/lib/backend';
import { CustomPropertyFields } from '../../properties/components/CustomPropertyFields';
import { usePropertyDefinitions } from '../../properties/hooks/usePropertyDefinitions';
import { useEmployees } from '../../../lib/hooks/useEmployees';
import { useCompanyActions } from '../hooks/useCompanyActions';
import { companyErrorMessage } from '../lib/errors';

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
  vatNumber: string;
  domain: string;
  website: string;
  sector: string;
  headcount: string;
  address: AddressValue;
  customProperties: Record<string, PropertyValue>;
  ownerIds: string[];
}

const emptyAddress = (country: string): AddressValue => ({
  country,
  streetNumber: '',
  street: '',
  postalCode: '',
  city: '',
});

function emptyForm(): FormState {
  return {
    name: '',
    country: DEFAULT_COUNTRY,
    registrationNumber: '',
    vatNumber: '',
    domain: '',
    website: '',
    sector: '',
    headcount: '',
    address: emptyAddress(DEFAULT_COUNTRY),
    customProperties: {},
    ownerIds: [],
  };
}

function fromCompany(company: Doc<'companies'>): FormState {
  return {
    name: company.name,
    country: company.country,
    registrationNumber: company.registrationNumber ?? '',
    vatNumber: company.vatNumber ?? '',
    domain: company.domain ?? '',
    website: company.website ?? '',
    sector: company.sector ?? '',
    headcount: company.headcount !== undefined ? String(company.headcount) : '',
    customProperties: { ...(company.customProperties ?? {}) },
    ownerIds: company.ownerIds,
    address: {
      country: company.address?.country ?? company.country,
      streetNumber: company.address?.streetNumber ?? '',
      street: company.address?.street ?? '',
      line2: company.address?.line2,
      postalCode: company.address?.postalCode ?? '',
      city: company.address?.city ?? '',
      region: company.address?.region,
    },
  };
}

/** An address block the user actually filled in (vs. the empty default). */
const hasAddress = (a: AddressValue) => !!(a.street || a.postalCode || a.city || a.region);

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
  const definitions = usePropertyDefinitions('company');
  const { employees } = useEmployees();

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
  const vatScheme = vatSchemeFor(form.country);
  const vatRegistration = resolveCountryInput(COMPANY_VAT_INPUT, form.country);
  const vatError = form.vatNumber
    ? vatScheme.validate(vatScheme.normalize(form.vatNumber), form.country)
    : null;
  const onVatData = useCallback((data: { name: string | null }) => {
    // VIES only returns the registered name: fill it when the form has none.
    if (data.name) setForm((prev) => (prev.name ? prev : { ...prev, name: data.name ?? '' }));
  }, []);
  const vatContext = useMemo<CompanyVatContext>(
    () => ({ country: form.country, onVatData }),
    [form.country, onVatData],
  );

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
            country: 'FR',
            streetNumber: a.numeroVoie ?? '',
            street: [a.typeVoie, a.libelleVoie].filter(Boolean).join(' '),
            postalCode: a.codePostal ?? '',
            city: a.libelleCommune ?? '',
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
    if (vatError) {
      toast.error(vatError);
      return;
    }
    const address = hasAddress(form.address)
      ? {
          country: form.address.country,
          streetNumber: form.address.streetNumber.trim(),
          street: form.address.street.trim(),
          line2: form.address.line2?.trim() || undefined,
          postalCode: form.address.postalCode.trim(),
          city: form.address.city.trim(),
          region: form.address.region || undefined,
        }
      : undefined;
    if (address) {
      const addressError = validateAddress(address);
      if (addressError) {
        toast.error(`Adresse : ${addressError}`);
        return;
      }
    }
    const headcount = form.headcount.trim() === '' ? undefined : Number(form.headcount);
    if (headcount !== undefined && (!Number.isInteger(headcount) || headcount < 0)) {
      toast.error('Effectif invalide.');
      return;
    }
    const payload = {
      name: form.name,
      country: form.country,
      // Empty strings reach the server as "clear this field".
      registrationNumber: form.registrationNumber,
      vatNumber: form.vatNumber,
      domain: form.domain,
      website: form.website,
      sector: form.sector,
      headcount,
      address,
      customProperties: form.customProperties,
      ownerIds: form.ownerIds as Id<'users'>[],
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
                setForm((prev) => ({
                  ...prev,
                  country: code,
                  registrationNumber: '',
                  vatNumber: '',
                  address: { ...prev.address, country: code, region: undefined },
                }));
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
            <Label htmlFor="company-vat">{vatRegistration.label ?? vatScheme.label}</Label>
            <CountryInput
              inputType={COMPANY_VAT_INPUT}
              country={form.country}
              id="company-vat"
              value={form.vatNumber}
              onChange={(v) => setField('vatNumber', v)}
              invalid={!!vatError}
              context={vatContext}
            />
            {vatError ? (
              <HelperText variant="error">{vatError}</HelperText>
            ) : vatRegistration.helperText ? (
              <HelperText>{vatRegistration.helperText}</HelperText>
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
              Les leads dont l’e-mail porte ce domaine se voient proposer le rattachement à la
              saisie, et sont rattachés automatiquement à l’import CSV.
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
        </div>

        <fieldset className="space-y-2 rounded-md border border-border p-3">
          <CountryAddressInput
            idPrefix="company"
            value={form.address}
            onChange={(v) => setField('address', v)}
            country={form.country}
            label={`Adresse (${countryName(form.country)})`}
          />
        </fieldset>

        <div className="space-y-1">
          <Label>Propriétaires</Label>
          <MultiSelect
            items={employees.map((e) => ({ value: e._id, label: `${e.firstName} ${e.lastName}` }))}
            value={form.ownerIds}
            onValueChange={(v) => setField('ownerIds', v)}
            placeholder="Aucun"
            modal
            className="w-full"
          />
        </div>

        <CustomPropertyFields
          definitions={definitions}
          values={form.customProperties}
          onChange={(id, value) =>
            setForm((prev) => {
              const next = { ...prev.customProperties };
              if (value === undefined) delete next[id];
              else next[id] = value;
              return { ...prev, customProperties: next };
            })
          }
        />

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
