import { useEffect, useState } from 'react';
import { useAuthAction } from '@crm/widgets';
import { api } from '@crm/lib/backend';
import type { VatLookupResult } from '@crm/lib/backend';
import { EU_COUNTRIES, vatSchemeFor } from '@crm/lib/backend';
import { Alert, AlertDescription, AlertTitle, Collapse, Input, Spinner } from '@crm/design-system';
import { registerCountryInput, type CountryInputProps } from './registry';

export const COMPANY_VAT_INPUT = 'companyVatNumber';

/** Context keys the VIES-backed input understands (all optional). */
export interface CompanyVatContext extends Record<string, unknown> {
  /** The company's country (drives the scheme); defaults to the registration's. */
  country?: string;
  /** Called with the VIES record when a lookup succeeds (prefill offer). */
  onVatData?: (data: Extract<VatLookupResult, { status: 'found' }>['data']) => void;
}

function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

function ViesVatInput({
  id,
  value,
  onChange,
  invalid,
  disabled,
  placeholder,
  context,
}: CountryInputProps) {
  const ctx = (context ?? {}) as CompanyVatContext;
  const country = (ctx.country ?? 'FR').toUpperCase();
  const scheme = vatSchemeFor(country);
  const normalized = scheme.normalize(value);
  const formatError = normalized ? scheme.validate(normalized, country) : null;
  const ready = !!normalized && !formatError && scheme.lookup;
  const debounced = useDebounced(ready ? normalized : '', 600);
  const lookup = useAuthAction(api.features.companies.actions.lookupVat);
  const [result, setResult] = useState<VatLookupResult | null>(null);
  const [fetching, setFetching] = useState(false);
  const onVatData = ctx.onVatData;

  useEffect(() => {
    if (!debounced) {
      setResult(null);
      setFetching(false);
      return;
    }
    let cancelled = false;
    setFetching(true);
    lookup({ country, value: debounced })
      .then((res) => {
        if (cancelled) return;
        const r = res as VatLookupResult;
        setResult(r);
        if (r.status === 'found') onVatData?.(r.data);
      })
      .catch(() => {
        if (!cancelled) setResult({ status: 'error', message: 'Vérification impossible.' });
      })
      .finally(() => {
        if (!cancelled) setFetching(false);
      });
    return () => {
      cancelled = true;
    };
  }, [debounced, country, lookup, onVatData]);

  return (
    <>
      <div className="relative">
        <Input
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          invalid={invalid || !!formatError}
          disabled={disabled}
          placeholder={placeholder ?? scheme.placeholder}
          autoComplete="off"
          className="pr-10"
        />
        {fetching ? (
          <Spinner
            size="sm"
            className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
        ) : null}
      </div>
      <Collapse open={!!result && !fetching}>
        <div className="pt-2">
          {result?.status === 'found' ? (
            <Alert variant="success">
              <AlertTitle>Numéro valide (VIES)</AlertTitle>
              <AlertDescription>
                {result.data.name ?? 'Nom non communiqué'}
                {result.data.address ? ` — ${result.data.address}` : ''}
              </AlertDescription>
            </Alert>
          ) : result?.status === 'not_found' ? (
            <Alert variant="warning">
              <AlertTitle>Numéro inconnu</AlertTitle>
              <AlertDescription>{result.message}</AlertDescription>
            </Alert>
          ) : result && result.status !== 'unsupported' ? (
            <Alert variant="warning">
              <AlertTitle>Vérification impossible</AlertTitle>
              <AlertDescription>{result.message}</AlertDescription>
            </Alert>
          ) : null}
        </div>
      </Collapse>
    </>
  );
}

/** Non-EU: local format check only (jsvat where known), no lookup. */
function PlainVatInput({
  id,
  value,
  onChange,
  invalid,
  disabled,
  placeholder,
  context,
}: CountryInputProps) {
  const country = ((context as CompanyVatContext | undefined)?.country ?? 'FR').toUpperCase();
  const scheme = vatSchemeFor(country);
  const normalized = scheme.normalize(value);
  const formatError = normalized ? scheme.validate(normalized, country) : null;
  return (
    <Input
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      invalid={invalid || !!formatError}
      disabled={disabled}
      placeholder={placeholder ?? scheme.placeholder}
      autoComplete="off"
    />
  );
}

for (const country of EU_COUNTRIES) {
  registerCountryInput(COMPANY_VAT_INPUT, country, {
    component: ViesVatInput,
    helperText: 'Vérifié en direct dans VIES (Commission européenne).',
  });
}
registerCountryInput(COMPANY_VAT_INPUT, '*', { component: PlainVatInput });
