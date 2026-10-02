import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { api } from '../../convex/_generated/api';
import { asIdentity, createTestConvex, seedEmployee } from './helpers';

// Made-up numbers with valid keys: a SIREN, two of its SIRET, its French VAT number.
const SIREN = '912345675';
const SIRET_HEAD_OFFICE = '91234567500017';
const SIRET_BRANCH = '91234567500025';
const VAT_FR = 'FR65912345675';
// A made-up RPPS number: 11 digits, the first one a 1.
const RPPS = '10012345678';

const SIRENE_URL = `https://recherche-entreprises.api.gouv.fr/search`;
const VIES_URL = 'https://ec.europa.eu/taxation_customs/vies/rest-api/check-vat-number';
const FHIR_URL = 'https://gateway.api.esante.gouv.fr/fhir/v2/Practitioner';
const SMARTCARD_URL =
  'https://interop.esante.gouv.fr/ig/fhir/annuaire/StructureDefinition/as-ext-smartcard';

type Sent = { method: string; url: string; headers: Record<string, string>; body: unknown };

const realFetch = globalThis.fetch;
const savedFhirKey = process.env.FHIR_API_KEY;
/** The registry's side: every request it received, and what it answers. */
let requests: Sent[] = [];
let answer: (sent: Sent) => Response;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const unreachable = (): Response => {
  throw new TypeError('fetch failed');
};

beforeEach(() => {
  process.env.FHIR_API_KEY = 'test-fhir-key';
  const mine: Sent[] = [];
  requests = mine;
  answer = unreachable;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    // Another file's background work must neither be counted nor reach the network.
    if (!/api\.gouv\.fr|ec\.europa\.eu|esante\.gouv\.fr/.test(url)) {
      return new Response(null, { status: 503 });
    }
    const sent: Sent = {
      method: init?.method ?? 'GET',
      url,
      headers: { ...(init?.headers as Record<string, string>) },
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    };
    mine.push(sent);
    return answer(sent);
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
  if (savedFhirKey === undefined) delete process.env.FHIR_API_KEY;
  else process.env.FHIR_API_KEY = savedFhirKey;
});

async function setup() {
  const t = createTestConvex();
  const emp = await seedEmployee(t, { email: 'ada@example.com', role: 'member' });
  const as = asIdentity(t, emp.identity);
  return { t, emp, as };
}
type As = ReturnType<typeof asIdentity>;

/** The failure branches log what happened (errors, and a warning for a spent budget): the lines are kept out of the test output and handed back. */
async function capturingLogs<R>(fn: () => Promise<R>): Promise<{ result: R; logged: string[] }> {
  const { error, warn } = console;
  const logged: string[] = [];
  const keep = (...args: unknown[]) => {
    logged.push(String(args[0]));
  };
  console.error = keep;
  console.warn = keep;
  try {
    return { result: await fn(), logged };
  } finally {
    console.error = error;
    console.warn = warn;
  }
}

const registration = (as: As, country: string, value: string) =>
  as.action(api.features.companies.actions.lookupRegistration, { country, value });
const vat = (as: As, country: string, value: string) =>
  as.action(api.features.companies.actions.lookupVat, { country, value });
const rpps = (as: As, value: string) =>
  as.action(api.features.practitionerInfo.actions.verifyRpps, { value });

const HEAD_OFFICE = {
  siret: SIRET_HEAD_OFFICE,
  adresse: '12 RUE DES LILAS 69003 LYON',
  numero_voie: '12',
  type_voie: 'RUE',
  libelle_voie: 'DES LILAS',
  code_postal: '69003',
  libelle_commune: 'LYON',
  etat_administratif: 'A',
  date_creation: '2019-04-01',
  activite_principale: '35.14Z',
};
const SIRENE_COMPANY = {
  siren: SIREN,
  nom_complet: 'NOVALUX ENERGIE (NOVALUX)',
  nom_raison_sociale: 'NOVALUX ENERGIE',
  etat_administratif: 'A',
  date_creation: '2019-04-01',
  activite_principale: '35.14Z',
  siege: HEAD_OFFICE,
  matching_etablissements: [],
};

describe('company registration lookup', () => {
  test('a SIREN is found with the head office and its split address', async () => {
    const { as } = await setup();
    answer = () => json({ results: [SIRENE_COMPANY], total_results: 1 });

    expect(await registration(as, 'fr', '912 345 675')).toEqual({
      status: 'found',
      data: {
        siren: SIREN,
        siret: SIRET_HEAD_OFFICE,
        denomination: 'NOVALUX ENERGIE',
        nom: null,
        prenom: null,
        etatAdministratif: 'A',
        dateCreation: '2019-04-01',
        activitePrincipale: '35.14Z',
        address: {
          numeroVoie: '12',
          typeVoie: 'RUE',
          libelleVoie: 'DES LILAS',
          codePostal: '69003',
          libelleCommune: 'LYON',
        },
      },
    });
    expect(requests).toEqual([
      {
        method: 'GET',
        url: `${SIRENE_URL}?q=${SIREN}&page=1&per_page=1`,
        headers: { Accept: 'application/json' },
        body: undefined,
      },
    ]);
  });

  test('a SIRET targets its establishment, whose one-line address gives the street', async () => {
    const { as } = await setup();
    const branch = {
      siret: SIRET_BRANCH,
      adresse: '4 QUAI DU PORT 13002 MARSEILLE',
      numero_voie: null,
      type_voie: null,
      libelle_voie: null,
      code_postal: '13002',
      libelle_commune: 'MARSEILLE',
      etat_administratif: 'F',
      date_creation: '2021-09-15',
      activite_principale: null,
    };
    answer = () => json({ results: [{ ...SIRENE_COMPANY, matching_etablissements: [branch] }] });

    expect(await registration(as, 'FR', SIRET_BRANCH)).toEqual({
      status: 'found',
      data: {
        siren: SIREN,
        siret: SIRET_BRANCH,
        denomination: 'NOVALUX ENERGIE',
        nom: null,
        prenom: null,
        etatAdministratif: 'F',
        dateCreation: '2021-09-15',
        // The establishment has none of its own: the company's is kept.
        activitePrincipale: '35.14Z',
        address: {
          numeroVoie: null,
          typeVoie: null,
          libelleVoie: '4 QUAI DU PORT',
          codePostal: '13002',
          libelleCommune: 'MARSEILLE',
        },
      },
    });
    expect(requests[0].url).toBe(`${SIRENE_URL}?q=${SIRET_BRANCH}&page=1&per_page=1`);
  });

  test('the SIRET of the head office keeps the split address of the head office', async () => {
    const { as } = await setup();
    const matched = {
      siret: SIRET_HEAD_OFFICE,
      adresse: '12 RUE DES LILAS 69003 LYON',
      numero_voie: null,
      type_voie: null,
      libelle_voie: null,
      code_postal: '69003',
      libelle_commune: 'LYON',
    };
    answer = () => json({ results: [{ ...SIRENE_COMPANY, matching_etablissements: [matched] }] });

    const result = await registration(as, 'FR', '912 345 675 00017');
    expect(result).toMatchObject({
      status: 'found',
      data: {
        siret: SIRET_HEAD_OFFICE,
        address: {
          numeroVoie: '12',
          typeVoie: 'RUE',
          libelleVoie: 'DES LILAS',
          codePostal: '69003',
          libelleCommune: 'LYON',
        },
      },
    });
  });

  test('a registry entry with nothing but a name is found with every other field null', async () => {
    const { as } = await setup();
    answer = () => json({ results: [{ nom_complet: 'ATELIER BRUME', etat_administratif: 'X' }] });

    expect(await registration(as, 'FR', SIREN)).toEqual({
      status: 'found',
      data: {
        siren: SIREN,
        siret: null,
        denomination: 'ATELIER BRUME',
        nom: null,
        prenom: null,
        etatAdministratif: null,
        dateCreation: null,
        activitePrincipale: null,
        address: null,
      },
    });
  });

  test('a number the registry does not know is not found', async () => {
    const { as } = await setup();
    const notFound = {
      status: 'not_found',
      message: 'Numéro non trouvé dans la base Sirene',
    } as const;

    answer = () => json({ results: [], total_results: 0 });
    expect(await registration(as, 'FR', SIREN)).toEqual(notFound);
    // An answer that is not JSON reads as an empty one.
    answer = () => new Response('<html>maintenance</html>', { status: 200 });
    expect(await registration(as, 'FR', SIREN)).toEqual(notFound);
    expect(requests).toHaveLength(2);
  });

  test('a country without a registry is unsupported, and nothing is requested', async () => {
    const { as } = await setup();
    expect(await registration(as, 'DE', ' HRB 12345 ')).toEqual({
      status: 'unsupported',
      message: 'Aucun registre consultable pour ce pays.',
    });
    expect(requests).toEqual([]);
  });

  test('a malformed number is an error before any request', async () => {
    const { as } = await setup();
    expect(await registration(as, 'FR', '1234')).toEqual({
      status: 'error',
      message: 'Un SIREN comporte 9 chiffres, un SIRET 14.',
    });
    expect(await registration(as, 'FR', '912345676')).toEqual({
      status: 'error',
      message: 'Numéro SIRET invalide (clé de contrôle).',
    });
    expect(await registration(as, 'DE', 'X'.repeat(65))).toEqual({
      status: 'error',
      message: 'Numéro trop long (64 caractères max).',
    });
    expect(requests).toEqual([]);
  });

  test('a registry that fails or cannot be reached is an error', async () => {
    const { as } = await setup();
    answer = () => new Response('Too Many Requests', { status: 429 });
    const refused = await capturingLogs(() => registration(as, 'FR', SIREN));
    expect(refused.result).toEqual({ status: 'error', message: 'Erreur API Sirene (429)' });
    expect(refused.logged).toEqual(['Sirene API error']);

    answer = unreachable;
    const down = await capturingLogs(() => registration(as, 'FR', SIREN));
    expect(down.result).toEqual({
      status: 'error',
      message: 'Erreur réseau lors de la vérification',
    });
    expect(down.logged).toEqual(['Sirene fetch failed']);
  });
});

describe('VAT number lookup', () => {
  test('a number VIES knows is found with its name and its address on one line', async () => {
    const { as } = await setup();
    answer = () =>
      json({
        countryCode: 'FR',
        vatNumber: '65912345675',
        valid: true,
        userError: 'VALID',
        name: 'SAS NOVALUX ENERGIE',
        address: '12 RUE DES LILAS\n69003 LYON',
      });

    expect(await vat(as, 'fr', 'fr 65 912.345.675')).toEqual({
      status: 'found',
      data: {
        vatNumber: VAT_FR,
        name: 'SAS NOVALUX ENERGIE',
        address: '12 RUE DES LILAS 69003 LYON',
      },
    });
    expect(requests).toEqual([
      {
        method: 'POST',
        url: VIES_URL,
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: { countryCode: 'FR', vatNumber: '65912345675' },
      },
    ]);
  });

  test('a member state that discloses nothing gives a found number without name or address', async () => {
    const { as } = await setup();
    answer = () => json({ valid: true, userError: 'VALID', name: '---', address: '---' });

    expect(await vat(as, 'DE', 'DE123456788')).toEqual({
      status: 'found',
      data: { vatNumber: 'DE123456788', name: null, address: null },
    });
    expect(requests[0].body).toEqual({ countryCode: 'DE', vatNumber: '123456788' });
  });

  test('a Greek number is asked to VIES under its EL code', async () => {
    const { as } = await setup();
    answer = () => json({ valid: true, userError: 'VALID', name: 'HELIOS TRADING', address: null });

    expect(await vat(as, 'GR', 'EL123456783')).toEqual({
      status: 'found',
      data: { vatNumber: 'EL123456783', name: 'HELIOS TRADING', address: null },
    });
    expect(requests[0].body).toEqual({ countryCode: 'EL', vatNumber: '123456783' });
  });

  test('a well-formed number VIES does not know is not found', async () => {
    const { as } = await setup();
    answer = () => json({ valid: false, userError: 'INVALID', name: '---', address: '---' });
    expect(await vat(as, 'FR', VAT_FR)).toEqual({
      status: 'not_found',
      message: 'Numéro de TVA inconnu de VIES',
    });
  });

  test('a country outside the European Union is unsupported, and nothing is requested', async () => {
    const { as } = await setup();
    expect(await vat(as, 'CH', 'CHE-123.456.788')).toEqual({
      status: 'unsupported',
      message: 'Aucun registre de TVA consultable pour ce pays.',
    });
    expect(requests).toEqual([]);
  });

  test('a number that fails its country format or key is an error before any request', async () => {
    const { as } = await setup();
    expect(await vat(as, 'FR', 'FR00912345678')).toEqual({
      status: 'error',
      message: 'Numéro de TVA invalide (clé de contrôle).',
    });
    // A Belgian number on a French company.
    expect(await vat(as, 'FR', 'BE0123456749')).toEqual({
      status: 'error',
      message: 'Numéro de TVA invalide pour ce pays (ex. FR12345678901).',
    });
    expect(await vat(as, 'US', '9'.repeat(33))).toEqual({
      status: 'error',
      message: 'Numéro trop long (32 caractères max).',
    });
    expect(requests).toEqual([]);
  });

  test('a VIES that is unavailable, fails or cannot be reached is an error', async () => {
    const { as } = await setup();
    answer = () => json({ valid: false, userError: 'MS_UNAVAILABLE' });
    expect(await vat(as, 'FR', VAT_FR)).toEqual({
      status: 'error',
      message: 'VIES indisponible (MS_UNAVAILABLE)',
    });

    answer = () => new Response('<html>maintenance</html>', { status: 200 });
    expect(await vat(as, 'FR', VAT_FR)).toEqual({
      status: 'error',
      message: 'Réponse VIES inattendue',
    });

    answer = () => new Response('Internal Server Error', { status: 500 });
    const failed = await capturingLogs(() => vat(as, 'FR', VAT_FR));
    expect(failed.result).toEqual({ status: 'error', message: 'Erreur VIES (500)' });
    expect(failed.logged).toEqual(['VIES API error']);

    answer = unreachable;
    const down = await capturingLogs(() => vat(as, 'FR', VAT_FR));
    expect(down.result).toEqual({
      status: 'error',
      message: 'Erreur réseau lors de la vérification VIES',
    });
    expect(down.logged).toEqual(['VIES fetch failed']);
  });
});

describe('registry lookup budget', () => {
  test('an employee has 60 lookups an hour across both registries, then an error', async () => {
    const { t, as } = await setup();
    const limited = {
      status: 'error',
      message: 'Trop de vérifications. Réessayez dans quelques minutes.',
    } as const;
    // A lookup is counted even when no registry is asked.
    for (let i = 0; i < 30; i++) {
      expect((await registration(as, 'DE', 'HRB 12345')).status).toBe('unsupported');
      expect((await vat(as, 'CH', 'CHE-123.456.788')).status).toBe('unsupported');
    }
    answer = () => json({ results: [SIRENE_COMPANY] });
    const overrun = await capturingLogs(async () => [
      await registration(as, 'FR', SIREN),
      await vat(as, 'FR', VAT_FR),
    ]);
    expect(overrun.result).toEqual([limited, limited]);
    expect(overrun.logged).toEqual(['rate_limit_exceeded', 'rate_limit_exceeded']);
    expect(requests).toEqual([]);

    // The budget is the employee's own.
    const other = await seedEmployee(t, { email: 'leo@example.com', role: 'member' });
    const found = await registration(asIdentity(t, other.identity), 'FR', SIREN);
    expect(found.status).toBe('found');
  });
});

const PRACTITIONER = {
  resourceType: 'Practitioner',
  id: '003-1234567',
  meta: { lastUpdated: '2026-01-15T08:30:00.000+01:00' },
  extension: [
    {
      url: SMARTCARD_URL,
      extension: [
        {
          url: 'type',
          valueCodeableConcept: {
            coding: [{ code: 'CPS', display: 'Carte de Professionnel de Santé' }],
          },
        },
        { url: 'number', valueString: '2800123456' },
        { url: 'period', valuePeriod: { start: '2024-02-01', end: '2027-02-01' } },
      ],
    },
  ],
  active: true,
  name: [
    { text: 'Claire FONTAINE', family: 'FONTAINE', given: ['Claire', 'Marie'], prefix: ['DR'] },
  ],
  qualification: [
    {
      code: {
        coding: [
          {
            system:
              'https://mos.esante.gouv.fr/NOS/TRE_R48-DiplomeEtatFrancais/FHIR/TRE-R48-DiplomeEtatFrancais',
            code: 'DE09',
            display: "Diplôme d'État de docteur en médecine",
          },
          {
            system:
              'https://mos.esante.gouv.fr/NOS/TRE_G15-ProfessionSante/FHIR/TRE-G15-ProfessionSante',
            code: '10',
            display: 'Médecin',
          },
        ],
      },
    },
  ],
};
const bundle = (...resources: unknown[]) => ({
  resourceType: 'Bundle',
  type: 'searchset',
  total: resources.length,
  entry: resources.map((resource) => ({ resource })),
});

describe('RPPS verification', () => {
  test('a practitioner is found with name, profession, diploma and card', async () => {
    const { as } = await setup();
    answer = () => json(bundle(PRACTITIONER));

    expect(await rpps(as, '1001 2345 678')).toEqual({
      status: 'found',
      data: {
        rpps: RPPS,
        fullName: 'Claire FONTAINE',
        family: 'FONTAINE',
        given: 'Claire',
        prefix: 'DR',
        active: true,
        profession: { code: '10', label: 'Médecin' },
        diploma: { code: 'DE09', label: "Diplôme d'État de docteur en médecine" },
        smartcard: {
          type: 'Carte de Professionnel de Santé',
          number: '2800123456',
          start: '2024-02-01',
          end: '2027-02-01',
        },
        lastUpdated: '2026-01-15T08:30:00.000+01:00',
      },
    });
    expect(requests).toEqual([
      {
        method: 'GET',
        url: `${FHIR_URL}?identifier=${RPPS}`,
        headers: { Accept: 'application/fhir+json', 'ESANTE-API-KEY': 'test-fhir-key' },
        body: undefined,
      },
    ]);
  });

  test('a bare directory entry is found inactive, with every detail null', async () => {
    const { as } = await setup();
    answer = () => json(bundle({ resourceType: 'Practitioner', id: '003-1234567' }));

    expect(await rpps(as, RPPS)).toEqual({
      status: 'found',
      data: {
        rpps: RPPS,
        fullName: null,
        family: null,
        given: null,
        prefix: null,
        active: false,
        profession: null,
        diploma: null,
        smartcard: null,
        lastUpdated: null,
      },
    });
  });

  test('codes stand in for missing labels, and a card without period has no dates', async () => {
    const { as } = await setup();
    answer = () =>
      json(
        bundle({
          resourceType: 'Practitioner',
          active: true,
          name: [{ family: 'FONTAINE' }],
          qualification: [
            { code: { coding: [{ system: 'urn:example:TRE-G15-ProfessionSante', code: '60' }] } },
          ],
          extension: [
            {
              url: SMARTCARD_URL,
              extension: [
                { url: 'type', valueCodeableConcept: { coding: [{ code: 'CPS' }] } },
                { url: 'number', valueString: '2800123456' },
              ],
            },
          ],
        }),
      );

    expect(await rpps(as, RPPS)).toMatchObject({
      status: 'found',
      data: {
        fullName: null,
        family: 'FONTAINE',
        profession: { code: '60', label: '60' },
        diploma: null,
        smartcard: { type: 'CPS', number: '2800123456', start: null, end: null },
      },
    });

    // A card without its number is no card.
    answer = () =>
      json(
        bundle({
          resourceType: 'Practitioner',
          extension: [
            {
              url: SMARTCARD_URL,
              extension: [{ url: 'type', valueCodeableConcept: { coding: [{ code: 'CPS' }] } }],
            },
          ],
        }),
      );
    expect(await rpps(as, RPPS)).toMatchObject({ status: 'found', data: { smartcard: null } });
  });

  test('a number the directory does not know is not found', async () => {
    const { as } = await setup();
    const notFound = {
      status: 'not_found',
      message: 'Numéro RPPS non trouvé dans l’Annuaire Santé',
    } as const;
    answer = () => json(bundle());
    expect(await rpps(as, RPPS)).toEqual(notFound);
    // A total without its entry counts for nothing.
    answer = () => json({ resourceType: 'Bundle', total: 1 });
    expect(await rpps(as, RPPS)).toEqual(notFound);
  });

  test('a malformed number is an error before any request', async () => {
    const { as } = await setup();
    const invalid = {
      status: 'error',
      message: 'Numéro RPPS invalide (11 chiffres, commence par 1)',
    } as const;
    expect(await rpps(as, '1001234567')).toEqual(invalid);
    expect(await rpps(as, '80012345678')).toEqual(invalid);
    expect(requests).toEqual([]);
  });

  test('a deployment without the directory key answers an error and requests nothing', async () => {
    const { as } = await setup();
    delete process.env.FHIR_API_KEY;
    const { result, logged } = await capturingLogs(() => rpps(as, RPPS));
    expect(result).toEqual({ status: 'error', message: 'FHIR_API_KEY non configurée' });
    expect(logged).toEqual(['FHIR_API_KEY not configured']);
    expect(requests).toEqual([]);
  });

  test('a directory that refuses, answers something else or cannot be reached is an error', async () => {
    const { as } = await setup();
    answer = () => new Response('Unauthorized', { status: 401 });
    const refused = await capturingLogs(() => rpps(as, RPPS));
    expect(refused.result).toEqual({
      status: 'error',
      message: 'Erreur API Annuaire Santé (401)',
    });
    expect(refused.logged).toEqual(['FHIR API error']);

    answer = () => json({ resourceType: 'OperationOutcome', issue: [{ severity: 'error' }] });
    expect(await rpps(as, RPPS)).toEqual({ status: 'error', message: 'Réponse FHIR inattendue' });

    answer = unreachable;
    const down = await capturingLogs(() => rpps(as, RPPS));
    expect(down.result).toEqual({
      status: 'error',
      message: 'Erreur réseau lors de la vérification',
    });
    expect(down.logged).toEqual(['FHIR fetch failed']);
  });

  test('an employee has 30 verifications an hour, then an error', async () => {
    const { as } = await setup();
    // A verification is counted even when the number is refused before the request.
    for (let i = 0; i < 30; i++) {
      expect((await rpps(as, '123')).status).toBe('error');
    }
    answer = () => json(bundle(PRACTITIONER));
    const overrun = await capturingLogs(() => rpps(as, RPPS));
    expect(overrun.result).toEqual({
      status: 'error',
      message: 'Trop de vérifications RPPS. Réessayez dans quelques minutes.',
    });
    expect(overrun.logged).toEqual(['rate_limit_exceeded']);
    expect(requests).toEqual([]);
  });
});

describe('lookups without a session', () => {
  test('a visitor who is not an employee is refused by every lookup', async () => {
    const { t } = await setup();
    await expect(
      t.action(api.features.companies.actions.lookupRegistration, { country: 'FR', value: SIREN }),
    ).rejects.toThrow('Unauthorized');
    await expect(
      t.action(api.features.companies.actions.lookupVat, { country: 'FR', value: VAT_FR }),
    ).rejects.toThrow('Unauthorized');
    await expect(
      t.action(api.features.practitionerInfo.actions.verifyRpps, { value: RPPS }),
    ).rejects.toThrow('Unauthorized');
    expect(requests).toEqual([]);
  });
});
