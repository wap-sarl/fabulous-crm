import { v } from 'convex/values';
import { employeeAction } from '../../_lib/auth';
import { registrationSchemeFor } from '../../_lib/validators/companyRegistry';
import { enforceRateLimit } from '../../lib/rateLimits';

// Local mirror of the design-system SiretCompanyData shape (convex can't
// import from src/; the frontend casts the result).
type SiretCompanyAddress = {
  numeroVoie: string | null;
  typeVoie: string | null;
  libelleVoie: string | null;
  codePostal: string | null;
  libelleCommune: string | null;
};
type SiretCompanyData = {
  siren: string;
  siret: string | null;
  denomination: string | null;
  nom: string | null;
  prenom: string | null;
  etatAdministratif: 'A' | 'C' | 'F' | null;
  dateCreation: string | null;
  activitePrincipale: string | null;
  address: SiretCompanyAddress | null;
};
export type RegistrationLookupResult =
  | { status: 'found'; data: SiretCompanyData }
  | { status: 'not_found'; message: string }
  | { status: 'unsupported'; message: string }
  | { status: 'error'; message: string };

const SIRENE_SEARCH_URL = 'https://recherche-entreprises.api.gouv.fr/search';

type SireneEtablissement = {
  siret?: string | null;
  // Full one-line address ("93 AVENUE DE PARIS 91300 MASSY"); the split
  // street parts below are null on `matching_etablissements` entries.
  adresse?: string | null;
  numero_voie?: string | null;
  type_voie?: string | null;
  libelle_voie?: string | null;
  code_postal?: string | null;
  libelle_commune?: string | null;
  etat_administratif?: string | null;
  date_creation?: string | null;
  activite_principale?: string | null;
};
type SireneResult = {
  siren?: string;
  nom_complet?: string | null;
  nom_raison_sociale?: string | null;
  etat_administratif?: string | null;
  date_creation?: string | null;
  activite_principale?: string | null;
  siege?: SireneEtablissement | null;
  matching_etablissements?: SireneEtablissement[] | null;
};

function withoutNulls<T extends object>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v != null)) as Partial<T>;
}

function etat(raw: string | null | undefined): 'A' | 'C' | 'F' | null {
  return raw === 'A' || raw === 'C' || raw === 'F' ? raw : null;
}

function mapSirene(digits: string, result: SireneResult): SiretCompanyData {
  const siren = result.siren ?? digits.slice(0, 9);
  // A 14-digit query targets one establishment: prefer the matched one over
  // the head office so the address matches what the user typed. Matched
  // entries only carry the one-line `adresse`; the head office has the split
  // street fields, so merge them when they are the same establishment.
  const matched =
    digits.length === 14
      ? result.matching_etablissements?.find((e) => e.siret === digits)
      : undefined;
  const siege = result.siege ?? null;
  let etablissement: SireneEtablissement | null = matched ?? siege;
  if (matched && siege && matched.siret === siege.siret) {
    etablissement = { ...siege, ...withoutNulls(matched) };
  }
  if (etablissement && !etablissement.libelle_voie && etablissement.adresse) {
    // Strip the "<postal code> <commune>" tail to keep the street line only.
    const tail = [etablissement.code_postal, etablissement.libelle_commune]
      .filter(Boolean)
      .join(' ');
    const street = tail ? etablissement.adresse.replace(tail, '').trim() : etablissement.adresse;
    etablissement = { ...etablissement, libelle_voie: street || null };
  }
  return {
    siren,
    siret: etablissement?.siret ?? null,
    denomination: result.nom_raison_sociale ?? result.nom_complet ?? null,
    nom: null,
    prenom: null,
    etatAdministratif: etat(etablissement?.etat_administratif ?? result.etat_administratif),
    dateCreation: etablissement?.date_creation ?? result.date_creation ?? null,
    activitePrincipale: etablissement?.activite_principale ?? result.activite_principale ?? null,
    address: etablissement
      ? {
          numeroVoie: etablissement.numero_voie ?? null,
          typeVoie: etablissement.type_voie ?? null,
          libelleVoie: etablissement.libelle_voie ?? null,
          codePostal: etablissement.code_postal ?? null,
          libelleCommune: etablissement.libelle_commune ?? null,
        }
      : null,
  };
}

async function lookupSirene(digits: string): Promise<RegistrationLookupResult> {
  let response: Response;
  try {
    const url = `${SIRENE_SEARCH_URL}?q=${digits}&page=1&per_page=1`;
    response = await fetch(url, { headers: { Accept: 'application/json' } });
  } catch (err) {
    console.error('Sirene fetch failed', err);
    return { status: 'error', message: 'Erreur réseau lors de la vérification' };
  }
  if (!response.ok) {
    console.error('Sirene API error', response.status);
    return { status: 'error', message: `Erreur API Sirene (${response.status})` };
  }
  const body = (await response.json().catch(() => null)) as { results?: SireneResult[] } | null;
  const result = body?.results?.[0];
  if (!result) return { status: 'not_found', message: 'Numéro non trouvé dans la base Sirene' };
  return { status: 'found', data: mapSirene(digits, result) };
}

export const lookupRegistration = employeeAction({
  args: { country: v.string(), value: v.string() },
  handler: async (ctx, { country, value }): Promise<RegistrationLookupResult> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!(await enforceRateLimit(ctx, 'registryVerify', identity?.subject ?? 'anonymous'))) {
      return {
        status: 'error',
        message: 'Trop de vérifications. Réessayez dans quelques minutes.',
      };
    }
    const scheme = registrationSchemeFor(country);
    const normalized = scheme.normalize(value);
    const error = scheme.validate(normalized);
    if (error) return { status: 'error', message: error };

    switch (scheme.id) {
      case 'siret':
        return await lookupSirene(normalized);
      default:
        return { status: 'unsupported', message: 'Aucun registre consultable pour ce pays.' };
    }
  },
});
