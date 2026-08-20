import * as React from 'react';
import { Alert, AlertDescription, AlertTitle } from './alert';
import { formatDate, formatDateTime } from './format-date';
import { Collapse } from '../surfaces/collapse';

export interface RppsPractitionerData {
  rpps: string;
  fullName: string | null;
  family: string | null;
  given: string | null;
  prefix: string | null;
  active: boolean;
  profession: { code: string; label: string } | null;
  diploma: { code: string; label: string } | null;
  smartcard: {
    type: string;
    number: string;
    start: string | null;
    end: string | null;
  } | null;
  lastUpdated: string | null;
}

export interface RppsPractitionerCardCompareTo {
  firstName?: string;
  lastName?: string;
  profession?: string;
}

export interface RppsPractitionerCardProps {
  data: RppsPractitionerData | null;
  compareTo?: RppsPractitionerCardCompareTo;
  variant?: 'full' | 'simple';
  notFound?: string | null;
  error?: string | null;
}

function normalize(s: string | null | undefined): string {
  return (s ?? '').trim().toLowerCase();
}

function matches(a: string | null | undefined, b: string | null | undefined): boolean {
  return normalize(a) === normalize(b);
}

function MatchChip({ ok, formValue }: { ok: boolean; formValue?: string }) {
  if (ok) {
    return (
      <span className="inline-flex items-center rounded-md bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary">
        ✓ correspond
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-warning/10 px-1.5 py-0.5 text-xs font-medium text-warning">
      ≠ saisie&nbsp;: {formValue ? <code className="font-mono">{formValue}</code> : <em>(vide)</em>}
    </span>
  );
}

function Row({
  label,
  apiValue,
  chip,
}: {
  label: string;
  apiValue: React.ReactNode;
  chip?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
      <span className="min-w-32 text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className="font-medium">
        {apiValue || <em className="text-muted-foreground">—</em>}
      </span>
      {chip}
    </div>
  );
}

function formatApiName(data: RppsPractitionerData): string {
  const parts = [data.prefix, data.family, data.given].filter(Boolean);
  return parts.join(' ');
}

function FoundBody({
  data,
  compareTo,
  variant,
}: {
  data: RppsPractitionerData;
  compareTo: RppsPractitionerCardCompareTo;
  variant: 'full' | 'simple';
}) {
  const apiFullName = data.fullName ?? formatApiName(data);
  const formFullName = `${compareTo.lastName ?? ''} ${compareTo.firstName ?? ''}`.trim();
  const familyMatches = matches(data.family, compareTo.lastName);
  const givenMatches = matches(data.given, compareTo.firstName);
  const nameMatches = familyMatches && givenMatches;

  const professionMatches = matches(data.profession?.label, compareTo.profession);

  const allMatch =
    data.active &&
    (!compareTo.firstName || !compareTo.lastName || nameMatches) &&
    (!compareTo.profession || professionMatches);

  return (
    <Alert variant={allMatch ? 'success' : 'warning'}>
      <AlertTitle>Annuaire Santé — RPPS {data.rpps}</AlertTitle>
      <AlertDescription className="mt-2 space-y-1">
        {variant === 'full' && (
          <Row
            label="Nom complet"
            apiValue={apiFullName}
            chip={
              compareTo.firstName || compareTo.lastName ? (
                <MatchChip ok={nameMatches} formValue={formFullName} />
              ) : undefined
            }
          />
        )}
        <Row
          label="Nom"
          apiValue={data.family}
          chip={
            compareTo.lastName ? (
              <MatchChip ok={familyMatches} formValue={compareTo.lastName} />
            ) : undefined
          }
        />
        <Row
          label="Prénom"
          apiValue={data.given}
          chip={
            compareTo.firstName ? (
              <MatchChip ok={givenMatches} formValue={compareTo.firstName} />
            ) : undefined
          }
        />
        <Row
          label="Profession"
          apiValue={data.profession?.label}
          chip={
            compareTo.profession ? (
              <MatchChip ok={professionMatches} formValue={compareTo.profession} />
            ) : undefined
          }
        />
        {variant === 'full' && (
          <>
            <Row label="Diplôme" apiValue={data.diploma?.label} />
            <Row
              label="État"
              apiValue={data.active ? 'Actif' : 'Inactif'}
              chip={
                !data.active ? (
                  <span className="inline-flex items-center rounded-md bg-destructive/10 px-1.5 py-0.5 text-xs font-medium text-destructive">
                    ⚠ praticien inactif
                  </span>
                ) : undefined
              }
            />
            {data.smartcard ? (
              <Row
                label="Carte CPS"
                apiValue={
                  <span>
                    {data.smartcard.type} n° {data.smartcard.number}
                    {data.smartcard.start || data.smartcard.end ? (
                      <span className="ml-1 text-muted-foreground">
                        ({formatDate(data.smartcard.start) ?? '?'} →{' '}
                        {formatDate(data.smartcard.end) ?? '?'})
                      </span>
                    ) : null}
                  </span>
                }
              />
            ) : null}
            {data.lastUpdated ? (
              <Row label="Mis à jour" apiValue={formatDateTime(data.lastUpdated)} />
            ) : null}
          </>
        )}
      </AlertDescription>
    </Alert>
  );
}

function RppsPractitionerCard({
  data,
  compareTo,
  variant = 'full',
  notFound,
  error,
}: RppsPractitionerCardProps) {
  const open = !!(data || notFound || error);
  return (
    <Collapse open={open}>
      <div className="pt-2">
        {error ? (
          <Alert variant="warning">
            <AlertTitle>Vérification impossible</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : notFound ? (
          <Alert variant="warning">
            <AlertTitle>Numéro RPPS non trouvé</AlertTitle>
            <AlertDescription>{notFound}</AlertDescription>
          </Alert>
        ) : data ? (
          <FoundBody data={data} compareTo={compareTo ?? {}} variant={variant} />
        ) : null}
      </div>
    </Collapse>
  );
}

export { RppsPractitionerCard };
