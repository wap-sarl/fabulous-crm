import { z } from 'zod';
import { EMAIL_ERROR_MESSAGES } from '@crm/lib/types';
import type { Id, PropertyValue } from '@crm/lib/backend';
import { DEFAULT_COUNTRY } from '@crm/lib/backend';
import type { AddressValue } from '@crm/design-system';
import type { LeadRow } from '../types';

export interface FormState {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  /** '' = the configured default stage (create only). */
  lifecycleStage: string;
  /** '' = none. The server never fills it in: a domain match is proposed, not applied. */
  companyId: Id<'companies'> | '';
  ownerIds: string[];
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

export function emptyForm(): FormState {
  return {
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    lifecycleStage: '',
    companyId: '',
    ownerIds: [],
    isRedFlagged: false,
    comment: '',
    address: EMPTY_ADDRESS,
    customProperties: {},
  };
}

export function fromLead(lead: LeadRow): FormState {
  return {
    firstName: lead.firstName,
    lastName: lead.lastName,
    email: lead.email ?? '',
    phone: lead.phone ?? '',
    lifecycleStage: lead.lifecycleStage ?? '',
    companyId: lead.companyId ?? '',
    ownerIds: lead.ownerIds,
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

export const identitySchema = z.object({
  firstName: z.string().trim().min(1, 'Le prénom est requis.'),
  lastName: z.string().trim().min(1, 'Le nom est requis.'),
  email: z
    .string()
    .trim()
    .min(1, 'L’e-mail est requis.')
    .pipe(z.email({ error: EMAIL_ERROR_MESSAGES.invalid })),
});
type Identity = z.infer<typeof identitySchema>;
export type RequiredField = keyof Identity;
export type FieldErrors = Partial<Record<RequiredField, string>>;

export function toFieldErrors(error: z.ZodError<Identity>): FieldErrors {
  const { fieldErrors } = z.flattenError(error);
  const errors: FieldErrors = {};
  for (const field of Object.keys(identitySchema.shape) as RequiredField[]) {
    const message = fieldErrors[field]?.[0];
    if (message) errors[field] = message;
  }
  return errors;
}
