import { describe, expect, test } from 'bun:test';
import { describeImportError, describeJobError } from '../../src/features/imports/lib/errorLabels';
import { setFrontendExtensionsForTests } from '../../src/lib/frontendExtensions';

describe('import error labels', () => {
  test('known codes read as sentences, their detail kept, anything else as it came', () => {
    expect(describeImportError('unknown_stage')).toBe('Étape inconnue dans ce pipeline');
    expect(describeImportError('invalid_registration_number: SIRET must have 14 digits')).toBe(
      'N° d’immatriculation invalide (SIRET must have 14 digits)',
    );
    expect(describeImportError('Prénom requis')).toBe('Prénom requis');
  });

  test('a job error carries a refusal as JSON, or a plain message; an overlay words its own codes, with their data', () => {
    // The core alone, said so: a refusal falls back to the code's label, or the code.
    setFrontendExtensionsForTests({});
    expect(describeJobError(JSON.stringify({ code: 'unknown_stage' }))).toBe(
      'Étape inconnue dans ce pipeline',
    );
    expect(describeJobError(JSON.stringify({ code: 'quota_exceeded', limit: 8 }))).toBe(
      'quota_exceeded',
    );
    expect(describeJobError('boom')).toBe('boom');

    setFrontendExtensionsForTests({
      describeRefusal: ({ code, data }) =>
        code === 'quota_exceeded' ? `Quota atteint : ${data.limit}.` : null,
    });
    expect(describeJobError(JSON.stringify({ code: 'quota_exceeded', limit: 8 }))).toBe(
      'Quota atteint : 8.',
    );
    // The codes it does not own keep the importer's words.
    expect(describeJobError(JSON.stringify({ code: 'unknown_stage' }))).toBe(
      'Étape inconnue dans ce pipeline',
    );
    expect(describeJobError('boom')).toBe('boom');
  });
});
