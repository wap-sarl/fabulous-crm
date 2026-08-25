import { useCallback } from 'react';
import { useAuthAction } from '@crm/widgets';
import { api } from '@crm/lib/backend';
import { VerifiedSIRETInput, type SiretVerificationResult } from '@crm/design-system';
import type { SiretCompanyCardCompareTo, SiretCompanyData } from '@crm/design-system';
import { registerCountryInput, type CountryInputProps } from './registry';

/**
 * `companyRegistrationNumber` — the national business identifier of a company.
 * France gets the SIRET input with the live Sirene lookup; every other country
 * falls back to the registry's plain input, labelled by the scheme
 * (`registrationSchemeFor` from convex/_lib/validators/companyRegistry.ts).
 */
export const COMPANY_REGISTRATION_INPUT = 'companyRegistrationNumber';

/** Context keys the SIRET input understands (all optional). */
export interface CompanyRegistrationContext extends Record<string, unknown> {
  /** Form address/name to cross-check against the registry card. */
  compareTo?: SiretCompanyCardCompareTo;
  /** Called with the registry record when a lookup succeeds (prefill offer). */
  onRegistryData?: (data: SiretCompanyData) => void;
}

function SiretRegistrationInput({
  id,
  value,
  onChange,
  invalid,
  disabled,
  context,
}: CountryInputProps) {
  const ctx = (context ?? {}) as CompanyRegistrationContext;
  const lookup = useAuthAction(api.features.companies.actions.lookupRegistration);
  const onRegistryData = ctx.onRegistryData;
  const verify = useCallback(
    async (digits: string): Promise<SiretVerificationResult> => {
      const result = (await lookup({ country: 'FR', value: digits })) as
        | SiretVerificationResult
        | { status: 'unsupported'; message: string };
      if (result.status === 'unsupported') return { status: 'error', message: result.message };
      if (result.status === 'found') onRegistryData?.(result.data);
      return result;
    },
    [lookup, onRegistryData],
  );
  return (
    <VerifiedSIRETInput
      id={id}
      value={value}
      onChange={onChange}
      invalid={invalid}
      disabled={disabled}
      verify={verify}
      compareTo={ctx.compareTo}
      helperText="Un SIREN comporte 9 chiffres, un SIRET 14."
    />
  );
}

registerCountryInput(COMPANY_REGISTRATION_INPUT, 'FR', {
  component: SiretRegistrationInput,
  helperText: 'Vérifié en direct dans la base Sirene (INSEE).',
});
// Every other country: the registry's plain input, labelled by the scheme.
