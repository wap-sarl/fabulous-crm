import { describe, expect, test } from 'bun:test';
import { ssoProviderIdOf, ssoProviderIdSchema } from '../../convex/_lib/validators/appConfig';
import { errorLabel } from '../../src/lib/errors';
import {
  emptySsoProvider,
  SETUP_ERRORS,
  ssoDraftsError,
  withSsoLabel,
} from '../../src/pages/setup/steps/types';

describe('the setup wizard', () => {
  test('refuses the id of a sign-in provider the backend would refuse', () => {
    const draft = (providerId: string, enabled = true) => ({
      ...emptySsoProvider(),
      label: 'Acme',
      issuerUrl: 'https://id.acme.example',
      clientId: 'cid',
      clientSecret: 'secret',
      providerId,
      enabled,
    });
    expect(ssoDraftsError([draft('mon-entreprise'), draft('acme', false)])).toBeNull();
    expect(ssoDraftsError([{ ...emptySsoProvider(), enabled: false }])).toBeNull();
    expect(ssoDraftsError([draft('')])).toContain('manquant');
    expect(ssoDraftsError([draft('mon-')])).toContain('invalide');
    expect(ssoDraftsError([draft('a'.repeat(65))])).toContain('64 caractères au plus');
    expect(ssoDraftsError([draft('Mon Entreprise', false)])).toContain('invalide');
    expect(ssoDraftsError([draft('acme'), draft('acme', false)])).toContain('uniques');
  });

  test('a long label gives an id the rule accepts, cut at 64 characters and never on a hyphen', () => {
    const long = 'Fédération nationale des établissements de santé privés de France';
    expect(ssoProviderIdOf(long)).toBe(
      'federation-nationale-des-etablissements-de-sante-prives-de-franc',
    );
    const onHyphen = `${'a'.repeat(63)} b`;
    expect(ssoProviderIdOf(onHyphen)).toBe('a'.repeat(63));
    for (const label of [long, onHyphen, `${'é'.repeat(200)}`, 'Acme']) {
      expect(ssoProviderIdSchema.safeParse(ssoProviderIdOf(label)).success).toBe(true);
    }
    const typed = { ...emptySsoProvider(), clientId: 'cid', clientSecret: 'secret' };
    const draft = { ...typed, issuerUrl: 'https://id.example', ...withSsoLabel(typed, long) };
    expect(ssoDraftsError([draft])).toBeNull();
  });

  test('the id follows the label until it is typed by hand', () => {
    const empty = emptySsoProvider();
    const first = { ...empty, ...withSsoLabel(empty, 'Acme') };
    expect(first.providerId).toBe('acme');
    expect(withSsoLabel(first, 'Acme Santé').providerId).toBe('acme-sante');
    const byHand = { ...first, providerId: 'mon-entreprise' };
    expect(withSsoLabel(byHand, 'Acme Santé')).toEqual({
      label: 'Acme Santé',
      providerId: 'mon-entreprise',
    });
  });

  test('what the setup refuses about an id has its sentence', () => {
    const fallback = 'Échec.';
    for (const code of [
      'sso_provider_invalid_id',
      'sso_provider_duplicate_id',
      'invalid_setup_token',
    ]) {
      expect(errorLabel(new Error(`Uncaught Error: ${code}`), SETUP_ERRORS, fallback)).not.toBe(
        fallback,
      );
    }
    expect(errorLabel(new Error('boom'), SETUP_ERRORS, fallback)).toBe(fallback);
  });
});
