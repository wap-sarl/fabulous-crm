import { Button } from '@crm/design-system';
import { ArrowLeft, Home } from 'lucide-react';
import { DecorativeSquares, LargeErrorCode } from './ErrorPageShared';

interface ErrorNotFoundPageProps {
  onGoHome?: () => void;
  onGoBack?: () => void;
  homePath?: string;
}

export function ErrorNotFoundPage({ onGoHome, onGoBack, homePath = '/' }: ErrorNotFoundPageProps) {
  const handleGoHome = () => {
    if (onGoHome) {
      onGoHome();
    } else {
      window.location.href = homePath;
    }
  };

  const handleGoBack = () => {
    if (onGoBack) {
      onGoBack();
    } else {
      window.history.back();
    }
  };

  return (
    <div className="min-h-screen bg-background relative flex items-center justify-center px-4">
      <DecorativeSquares />

      <div className="relative z-10 text-center max-w-2xl mx-auto">
        {/* Large 404 */}
        <div className="flex justify-center mb-4">
          <LargeErrorCode code="404" />
        </div>

        {/* Title */}
        <h1 className="text-3xl md:text-4xl font-bold text-ink mb-4">Page introuvable</h1>

        {/* Description */}
        <p className="text-lg text-soft mb-8 max-w-md mx-auto">
          Oups ! La page que vous recherchez semble avoir disparu ou n'existe pas.
        </p>

        {/* Actions */}
        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <Button variant="fill" size="lg" onClick={handleGoHome} className="gap-2">
            <Home className="w-5 h-5" />
            Retour à l'accueil
          </Button>
          <Button variant="outline" size="lg" onClick={handleGoBack} className="gap-2">
            <ArrowLeft className="w-5 h-5" />
            Page précédente
          </Button>
        </div>
      </div>
    </div>
  );
}
