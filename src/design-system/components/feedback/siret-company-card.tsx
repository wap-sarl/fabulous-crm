import * as React from 'react';
import { Alert, AlertDescription, AlertTitle } from './alert';
import { formatDate } from './format-date';
import { Collapse } from '../surfaces/collapse';

export interface SiretCompanyAddress {
  numeroVoie: string | null;
  typeVoie: string | null;
  libelleVoie: string | null;
  codePostal: string | null;
  libelleCommune: string | null;
}

export interface SiretCompanyData {
  siren: string;
  siret: string | null;
  denomination: string | null;
  nom: string | null;
  prenom: string | null;
  etatAdministratif: 'A' | 'C' | 'F' | null;
  dateCreation: string | null;
  activitePrincipale: string | null;
  address: SiretCompanyAddress | null;
}

export interface SiretCompanyCardCompareTo {
  firstName?: string;
  lastName?: string;
  streetNumber?: string;
  street?: string;
  postalCode?: string;
  city?: string;
}

export interface SiretCompanyCardProps {
  data: SiretCompanyData | null;
  compareTo?: SiretCompanyCardCompareTo;
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

function formatAddress(data: SiretCompanyData): string {
  if (!data.address) return '';
  const { numeroVoie, typeVoie, libelleVoie } = data.address;
  return [numeroVoie, typeVoie, libelleVoie].filter(Boolean).join(' ');
}

function formatFormStreet(compareTo: SiretCompanyCardCompareTo): string {
  return [compareTo.streetNumber, compareTo.street].filter(Boolean).join(' ');
}

function FoundBody({
  data,
  compareTo,
}: {
  data: SiretCompanyData;
  compareTo: SiretCompanyCardCompareTo;
}) {
  const isIndividual = !data.denomination && (data.nom || data.prenom);
  const apiName = data.denomination ?? (`${data.nom ?? ''} ${data.prenom ?? ''}`.trim() || null);
  const formFullName = `${compareTo.lastName ?? ''} ${compareTo.firstName ?? ''}`.trim();
  const nameMatches = matches(apiName, formFullName);

  const apiStreet = formatAddress(data);
  const formStreet = formatFormStreet(compareTo);

  const isActive = data.etatAdministratif === 'A';

  return (
    <Alert variant={isActive ? 'success' : 'warning'}>
      <AlertTitle>
        Données INSEE — {data.siret ? `SIRET ${data.siret}` : `SIREN ${data.siren}`}
      </AlertTitle>
      <AlertDescription className="mt-2 space-y-1">
        <Row
          label={isIndividual ? 'Nom / Prénom' : 'Dénomination'}
          apiValue={apiName}
          chip={
            isIndividual && (compareTo.firstName || compareTo.lastName) ? (
              <MatchChip ok={nameMatches} formValue={formFullName} />
            ) : undefined
          }
        />
        <Row
          label="État"
          apiValue={
            data.etatAdministratif === 'A'
              ? 'Active'
              : data.etatAdministratif === 'C' || data.etatAdministratif === 'F'
                ? 'Cessée'
                : 'Inconnu'
          }
          chip={
            !isActive ? (
              <span className="inline-flex items-center rounded-md bg-destructive/10 px-1.5 py-0.5 text-xs font-medium text-destructive">
                ⚠ entreprise non active
              </span>
            ) : undefined
          }
        />
        {data.address ? (
          <>
            <Row
              label="Numéro et voie"
              apiValue={apiStreet}
              chip={
                formStreet ? (
                  <MatchChip ok={matches(apiStreet, formStreet)} formValue={formStreet} />
                ) : undefined
              }
            />
            <Row
              label="Code postal"
              apiValue={data.address.codePostal}
              chip={
                compareTo.postalCode ? (
                  <MatchChip
                    ok={matches(data.address.codePostal, compareTo.postalCode)}
                    formValue={compareTo.postalCode}
                  />
                ) : undefined
              }
            />
            <Row
              label="Ville"
              apiValue={data.address.libelleCommune}
              chip={
                compareTo.city ? (
                  <MatchChip
                    ok={matches(data.address.libelleCommune, compareTo.city)}
                    formValue={compareTo.city}
                  />
                ) : undefined
              }
            />
          </>
        ) : (
          <p className="text-xs italic text-muted-foreground">
            Vérification SIREN&nbsp;: adresse non fournie. Saisissez un SIRET 14 chiffres pour
            comparer l'adresse.
          </p>
        )}
        <Row label="Activité principale (NAF)" apiValue={data.activitePrincipale} />
        <Row label="Date de création" apiValue={formatDate(data.dateCreation)} />
      </AlertDescription>
    </Alert>
  );
}

function SiretCompanyCard({ data, compareTo, notFound, error }: SiretCompanyCardProps) {
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
            <AlertTitle>Numéro non trouvé</AlertTitle>
            <AlertDescription>{notFound}</AlertDescription>
          </Alert>
        ) : data ? (
          <FoundBody data={data} compareTo={compareTo ?? {}} />
        ) : null}
      </div>
    </Collapse>
  );
}

export { SiretCompanyCard };
