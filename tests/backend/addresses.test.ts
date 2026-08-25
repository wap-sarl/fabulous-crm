import { describe, expect, test } from 'bun:test';
import { api } from '../../convex/_generated/api';
import {
  addressFormatFor,
  formatAddressLines,
  formatAddressOneLine,
  validateAddress,
} from '../../convex/_lib/validators/addressFormats';
import { asIdentity, createTestConvex, seedEmployee } from './helpers';

async function setup() {
  const t = createTestConvex();
  const emp = await seedEmployee(t, { email: 'agent@example.com', role: 'admin' });
  const as = asIdentity(t, emp.identity);
  return { t, emp, as };
}

const FR = {
  country: 'FR',
  streetNumber: '8',
  street: 'Boulevard du Port',
  postalCode: '80000',
  city: 'Amiens',
};
const US = {
  country: 'US',
  streetNumber: '1600',
  street: 'Amphitheatre Pkwy',
  postalCode: '94043',
  city: 'Mountain View',
  region: 'CA',
};

describe('address formats (libaddressinput metadata, pure)', () => {
  test('lay out fields in the country order with local labels and requirements', () => {
    const fr = addressFormatFor('fr');
    expect(fr.fields.map((f) => f.key)).toEqual(['street', 'postalCode', 'city']);
    expect(fr.fields.find((f) => f.key === 'postalCode')).toMatchObject({
      label: 'Code postal',
      required: true,
    });

    const us = addressFormatFor('US');
    expect(us.fields.map((f) => f.key)).toEqual(['street', 'city', 'region', 'postalCode']);
    const state = us.fields.find((f) => f.key === 'region');
    expect(state).toMatchObject({ label: 'État', required: true });
    expect(state?.options?.some(([key, name]) => key === 'CA' && name === 'California')).toBe(true);
    expect(us.fields.find((f) => f.key === 'postalCode')?.label).toBe('Code ZIP');

    // Japan (Latin variant "%A, %S%n%Z"): no separate city line — the
    // municipality is part of the street lines — so the city field trails, optional.
    expect(addressFormatFor('JP').fields.map((f) => f.key)).toEqual([
      'street',
      'region',
      'postalCode',
      'city',
    ]);
    expect(addressFormatFor('JP').fields.find((f) => f.key === 'city')?.required).toBe(false);
    expect(addressFormatFor('JP').fields.find((f) => f.key === 'region')?.label).toBe('Préfecture');

    // Unknown country: the generic fallback (street + city, optional postal code).
    const zz = addressFormatFor('XX');
    expect(zz.fields.map((f) => f.key)).toEqual(['street', 'city', 'postalCode']);
    expect(zz.fields.find((f) => f.key === 'postalCode')?.required).toBe(false);
  });

  test('validate required fields, postal-code patterns and region keys', () => {
    expect(validateAddress(FR)).toBeNull();
    expect(validateAddress({ ...FR, postalCode: '8000' })).toMatch(/Code postal invalide/);
    expect(validateAddress({ ...FR, city: '' })).toBe('Ville : requis.');
    expect(validateAddress(US)).toBeNull();
    expect(validateAddress({ ...US, region: undefined })).toBe('État : requis.');
    expect(validateAddress({ ...US, region: 'ZZ' })).toMatch(/valeur inconnue/);
    expect(validateAddress({ ...US, postalCode: '9404' })).toMatch(/Code ZIP invalide/);
    expect(validateAddress({ ...FR, country: 'France' })).toMatch(/Pays invalide/);
    // Ireland: postal code optional; UK postcode pattern.
    expect(validateAddress({ ...FR, country: 'IE', postalCode: '', city: 'Dublin' })).toBeNull();
    expect(
      validateAddress({ ...FR, country: 'GB', postalCode: 'SW1A 1AA', city: 'London' }),
    ).toBeNull();
    expect(validateAddress({ ...FR, country: 'GB', postalCode: '12345', city: 'London' })).toMatch(
      /invalide/,
    );
  });

  test('format in the country writing order, upper-casing what the post wants', () => {
    expect(formatAddressLines(FR)).toEqual(['8 Boulevard du Port', '80000 AMIENS']);
    expect(formatAddressLines({ ...FR, line2: 'Bâtiment B' })).toEqual([
      '8 Boulevard du Port',
      'Bâtiment B',
      '80000 AMIENS',
    ]);
    expect(formatAddressLines(US)).toEqual(['1600 Amphitheatre Pkwy', 'MOUNTAIN VIEW, CA 94043']);
    expect(
      formatAddressLines({ ...FR, country: 'DE', postalCode: '10115', city: 'Berlin' }),
    ).toEqual(['8 Boulevard du Port', '10115 Berlin']);
    expect(formatAddressOneLine(FR, (c) => (c === 'FR' ? 'France' : c))).toBe(
      '8 Boulevard du Port, 80000 AMIENS, France',
    );
  });
});

describe('address validation in mutations', () => {
  test('leads and companies refuse an address that breaks its country format', async () => {
    const { t, as } = await setup();
    await expect(
      as.mutation(api.features.crm.mutations.createLead, {
        firstName: 'A',
        lastName: 'A',
        address: { ...FR, postalCode: 'ABC' },
      }),
    ).rejects.toThrow('invalid_address');
    const leadId = await as.mutation(api.features.crm.mutations.createLead, {
      firstName: 'A',
      lastName: 'A',
      address: US,
    });
    expect((await t.run((ctx) => ctx.db.get(leadId)))?.address).toMatchObject({
      country: 'US',
      region: 'CA',
    });

    await expect(
      as.mutation(api.features.companies.mutations.createCompany, {
        name: 'Acme',
        address: { ...US, region: undefined },
      }),
    ).rejects.toThrow('État : requis');
  });

  test('CSV rows with an invalid address are row errors', async () => {
    const { as } = await setup();
    const res = await as.mutation(api.features.crm.mutations.importLeads, {
      rows: [
        { firstName: 'A', lastName: 'A', email: 'a@acme.fr', address: FR },
        { firstName: 'B', lastName: 'B', email: 'b@acme.fr', address: { ...FR, postalCode: '1' } },
      ],
    });
    expect(res.created).toBe(1);
    expect(res.errors[0].error).toContain('invalid_address');
  });

  test('{{ params.address }} follows the country order and only names foreign countries', async () => {
    const { formatAddressParam } = await import('../../convex/features/crm/leadTargets');
    expect(formatAddressParam(FR)).toBe('8 Boulevard du Port, 80000 AMIENS');
    expect(formatAddressParam(US)).toBe('1600 Amphitheatre Pkwy, MOUNTAIN VIEW, CA 94043, US');
  });
});
