import type { ComponentType } from 'react';
import { Input } from '@crm/design-system';

export interface CountryInputProps {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  invalid?: boolean;
  disabled?: boolean;
  placeholder?: string;
  /**
   * Free-form context a specific input may use (e.g. the surrounding form's
   * address to compare against registry data, or a callback to prefill it).
   * Inputs must degrade gracefully when a key is absent.
   */
  context?: Record<string, unknown>;
}

export interface CountryInputRegistration {
  component: ComponentType<CountryInputProps>;
  /** Field label when the registration overrides the scheme's default. */
  label?: string;
  helperText?: string;
}

export const ANY_COUNTRY = '*';

const registry = new Map<string, Map<string, CountryInputRegistration>>();

export function registerCountryInput(
  inputType: string,
  country: string,
  registration: CountryInputRegistration,
): void {
  let byCountry = registry.get(inputType);
  if (!byCountry) {
    byCountry = new Map();
    registry.set(inputType, byCountry);
  }
  byCountry.set(country.toUpperCase(), registration);
}

/** The default control: a bare text input. Exported for reuse by registrations. */
export function PlainCountryInput({ context: _context, ...props }: CountryInputProps) {
  return (
    <Input
      {...props}
      value={props.value}
      onChange={(e) => props.onChange(e.target.value)}
      invalid={props.invalid}
    />
  );
}

const FALLBACK: CountryInputRegistration = { component: PlainCountryInput };

/** The registration for `(inputType, country)`: exact, then `*`, then a plain input. */
export function resolveCountryInput(
  inputType: string,
  country: string | undefined,
): CountryInputRegistration {
  const byCountry = registry.get(inputType);
  if (!byCountry) return FALLBACK;
  return byCountry.get((country ?? '').toUpperCase()) ?? byCountry.get(ANY_COUNTRY) ?? FALLBACK;
}

/** Registered countries for an input type (for tests / diagnostics). */
export function registeredCountries(inputType: string): string[] {
  return [...(registry.get(inputType)?.keys() ?? [])];
}

export interface CountryInputElementProps extends CountryInputProps {
  inputType: string;
  country: string | undefined;
}

/** Render the input registered for `(inputType, country)`. */
export function CountryInput({ inputType, country, ...props }: CountryInputElementProps) {
  const { component: Component } = resolveCountryInput(inputType, country);
  return <Component {...props} />;
}
