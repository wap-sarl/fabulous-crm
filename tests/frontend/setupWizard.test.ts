import { describe, expect, test } from 'bun:test';
import { emptySsoProvider, ssoDraftsError } from '../../src/pages/setup/steps/types';

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
    expect(ssoDraftsError([draft('Mon Entreprise', false)])).toContain('invalide');
    expect(ssoDraftsError([draft('acme'), draft('acme', false)])).toContain('uniques');
  });
});
