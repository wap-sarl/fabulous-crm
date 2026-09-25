import { describe, expect, test } from 'bun:test';
import { describeImportError, describeJobError } from '../../src/features/imports/lib/errorLabels';

describe('import error labels', () => {
  test('known codes read as sentences, their detail kept, anything else as it came', () => {
    expect(describeImportError('unknown_stage')).toBe('Étape inconnue dans ce pipeline');
    expect(describeImportError('invalid_registration_number: SIRET must have 14 digits')).toBe(
      'N° d’immatriculation invalide (SIRET must have 14 digits)',
    );
    expect(describeImportError('Prénom requis')).toBe('Prénom requis');
  });

  test('a job error carries a refusal as JSON, or a plain message', () => {
    // No overlay in the public CRM: a refusal falls back to the code's label, or the code.
    expect(describeJobError(JSON.stringify({ code: 'unknown_stage' }))).toBe(
      'Étape inconnue dans ce pipeline',
    );
    expect(describeJobError(JSON.stringify({ code: 'quota_exceeded', limit: 8 }))).toBe(
      'quota_exceeded',
    );
    expect(describeJobError('boom')).toBe('boom');
  });
});
