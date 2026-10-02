import type { Doc, PropertyValue } from '@crm/lib/backend';
import { DEFAULT_COUNTRY } from '@crm/lib/backend';
import type { AddressValue } from '@crm/design-system';

export interface FormState {
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

export function emptyForm(): FormState {
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

export function fromCompany(company: Doc<'companies'>): FormState {
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
