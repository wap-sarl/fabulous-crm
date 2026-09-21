/** What the connectors' callback reports in `?error=`: ours, or a provider's own code we know how to say. */
export const CONNECTION_ERRORS: Record<string, string> = {
  invalid_state: 'La demande de connexion a expiré ou n’est pas valide. Recommencez.',
  invalid_finish: 'La demande de connexion a expiré ou n’est pas valide. Recommencez.',
  account_mismatch:
    'Cette connexion a été démarrée par un autre utilisateur : le compte n’a pas été lié.',
  access_denied: 'Vous avez refusé l’accès chez le fournisseur.',
  no_refresh_token:
    'Le fournisseur n’a pas accordé d’accès durable. Retirez l’accès de cette application dans votre compte, puis recommencez.',
  provider_not_configured: 'Ce fournisseur n’est pas configuré.',
  no_account_identity: 'Le fournisseur n’a pas indiqué de quel compte il s’agit.',
};

/** The toast for a failed connection: our sentence for a code we know; else a generic one, with what the provider said when it said something. */
export function describeConnectionError(
  code: string | null,
  providerDescription: string | null,
): { message: string; description: string | null } {
  const known = CONNECTION_ERRORS[code ?? ''];
  if (known) return { message: known, description: null };
  const said = providerDescription?.trim();
  return {
    message: 'La connexion a échoué. Recommencez.',
    // Attributed, so nobody reads the provider's words as the CRM's.
    description: said ? `Message du fournisseur : ${said}` : null,
  };
}
