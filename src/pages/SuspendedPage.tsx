import { Button } from '@crm/design-system';
import { useAuth, usePublicConfig } from '@crm/widgets';
import { LogOut } from 'lucide-react';
import { DecorativeSquares, LargeErrorCode } from '../widgets/pages/ErrorPageShared';

/** Billing interstitial of the hosted edition: shown instead of the shell while the tenant is suspended. */
export function SuspendedPage() {
  const { logout } = useAuth();
  const { config } = usePublicConfig();
  return (
    <div className="min-h-screen bg-background relative flex items-center justify-center px-4">
      <DecorativeSquares />
      <div className="relative z-10 text-center max-w-2xl mx-auto">
        <div className="flex justify-center mb-4">
          <LargeErrorCode code="402" />
        </div>
        <h1 className="text-3xl md:text-4xl font-bold text-ink mb-4">Accès suspendu</h1>
        <p className="text-lg text-soft mb-8 max-w-md mx-auto">
          L’abonnement de {config?.organizationName ?? 'votre organisation'} n’est plus à jour. Vos
          données sont conservées et l’accès reprend dès la régularisation du paiement.
        </p>
        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <Button variant="outline" size="lg" onClick={() => logout()} className="gap-2">
            <LogOut className="w-5 h-5" />
            Se déconnecter
          </Button>
        </div>
      </div>
    </div>
  );
}
