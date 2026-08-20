import { v } from 'convex/values';
import { employeeAction } from '../../_lib/auth';

/**
 * RPPS verification against the FHIR Annuaire Santé API. The API key is a server
 * secret (`FHIR_API_KEY`, set via `bunx convex env set`), so this must never run
 * in the browser — the lead form calls it through this authenticated action. The
 * result is display/validation only; the RPPS number itself is stored as a plain
 * string custom-property value on the lead. Mirrors the sibling monorepo's
 * `features/practitionerInfo/actions.ts`.
 */

const FHIR_BASE_URL = 'https://gateway.api.esante.gouv.fr/fhir/v2';
const RPPS_LENGTH = 11;
const RPPS_LEADING_DIGIT = '1';

const PROFESSION_SYSTEM_SUFFIX = 'TRE-G15-ProfessionSante';
const DIPLOMA_SYSTEM_SUFFIX = 'TRE-R48-DiplomeEtatFrancais';
const SMARTCARD_EXTENSION_URL =
  'https://interop.esante.gouv.fr/ig/fhir/annuaire/StructureDefinition/as-ext-smartcard';

// Local mirrors of the design-system RppsPractitionerData / RppsVerificationResult
// shapes (convex can't import from src/; the frontend casts the action result to
// its own type — the structures are kept identical).
type RppsQualification = { code: string; label: string };
type RppsSmartcard = { type: string; number: string; start: string | null; end: string | null };
type RppsPractitioner = {
  rpps: string;
  fullName: string | null;
  family: string | null;
  given: string | null;
  prefix: string | null;
  active: boolean;
  profession: RppsQualification | null;
  diploma: RppsQualification | null;
  smartcard: RppsSmartcard | null;
  lastUpdated: string | null;
};
type RppsVerificationResult =
  | { status: 'found'; data: RppsPractitioner }
  | { status: 'not_found'; message: string }
  | { status: 'error'; message: string };

type FhirCoding = { system?: string | null; code?: string | null; display?: string | null };
type FhirCodeableConcept = { coding?: FhirCoding[] };
type FhirName = {
  text?: string | null;
  family?: string | null;
  given?: string[] | null;
  prefix?: string[] | null;
};
type FhirQualification = { code?: FhirCodeableConcept };
type FhirNestedExtension = {
  url?: string | null;
  valueString?: string | null;
  valueCodeableConcept?: FhirCodeableConcept;
  valuePeriod?: { start?: string | null; end?: string | null };
};
type FhirExtension = { url?: string | null; extension?: FhirNestedExtension[] };
type FhirPractitioner = {
  resourceType: 'Practitioner';
  id?: string;
  meta?: { lastUpdated?: string | null };
  extension?: FhirExtension[];
  active?: boolean;
  name?: FhirName[];
  qualification?: FhirQualification[];
};
type FhirBundleEntry = { resource?: FhirPractitioner };
type FhirBundle = { resourceType: 'Bundle'; total?: number; entry?: FhirBundleEntry[] };

function findCoding(
  qualifications: FhirQualification[] | undefined,
  systemSuffix: string
): RppsQualification | null {
  if (!qualifications) return null;
  for (const q of qualifications) {
    const coding = q.code?.coding;
    if (!coding) continue;
    for (const c of coding) {
      if (c.system?.endsWith(systemSuffix) && c.code) {
        return { code: c.code, label: c.display ?? c.code };
      }
    }
  }
  return null;
}

function extractSmartcard(extensions: FhirExtension[] | undefined): RppsSmartcard | null {
  if (!extensions) return null;
  const smartcard = extensions.find((ext) => ext.url === SMARTCARD_EXTENSION_URL);
  if (!smartcard?.extension) return null;
  let type: string | null = null;
  let number: string | null = null;
  let start: string | null = null;
  let end: string | null = null;
  for (const sub of smartcard.extension) {
    if (sub.url === 'type') {
      const coding = sub.valueCodeableConcept?.coding?.[0];
      type = coding?.display ?? coding?.code ?? null;
    } else if (sub.url === 'number') {
      number = sub.valueString ?? null;
    } else if (sub.url === 'period') {
      start = sub.valuePeriod?.start ?? null;
      end = sub.valuePeriod?.end ?? null;
    }
  }
  if (!type || !number) return null;
  return { type, number, start, end };
}

function mapPractitioner(rpps: string, resource: FhirPractitioner): RppsPractitioner {
  const name = resource.name?.[0];
  return {
    rpps,
    fullName: name?.text ?? null,
    family: name?.family ?? null,
    given: name?.given?.[0] ?? null,
    prefix: name?.prefix?.[0] ?? null,
    active: resource.active ?? false,
    profession: findCoding(resource.qualification, PROFESSION_SYSTEM_SUFFIX),
    diploma: findCoding(resource.qualification, DIPLOMA_SYSTEM_SUFFIX),
    smartcard: extractSmartcard(resource.extension),
    lastUpdated: resource.meta?.lastUpdated ?? null,
  };
}

export const verifyRpps = employeeAction({
  args: { value: v.string() },
  handler: async (_ctx, { value }): Promise<RppsVerificationResult> => {
    const apiKey = process.env.FHIR_API_KEY;
    if (!apiKey) {
      console.error('FHIR_API_KEY not configured');
      return { status: 'error', message: 'FHIR_API_KEY non configurée' };
    }

    const digits = value.replace(/\D/g, '');
    if (digits.length !== RPPS_LENGTH || digits[0] !== RPPS_LEADING_DIGIT) {
      return { status: 'error', message: 'Numéro RPPS invalide (11 chiffres, commence par 1)' };
    }

    let response: Response;
    try {
      response = await fetch(`${FHIR_BASE_URL}/Practitioner?identifier=${digits}`, {
        headers: {
          Accept: 'application/fhir+json',
          'ESANTE-API-KEY': apiKey,
        },
      });
    } catch (err) {
      console.error('FHIR fetch failed', err);
      return { status: 'error', message: 'Erreur réseau lors de la vérification' };
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      console.error('FHIR API error', response.status, text);
      return {
        status: 'error',
        message: `Erreur API Annuaire Santé (${response.status})`,
      };
    }

    const body = (await response.json().catch(() => null)) as FhirBundle | null;
    if (!body || body.resourceType !== 'Bundle') {
      return { status: 'error', message: 'Réponse FHIR inattendue' };
    }

    const entry = body.entry?.[0]?.resource;
    if (!body.total || body.total === 0 || !entry) {
      return { status: 'not_found', message: 'Numéro RPPS non trouvé dans l’Annuaire Santé' };
    }

    return { status: 'found', data: mapPractitioner(digits, entry) };
  },
});
