import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button, Spinner } from '@crm/design-system';
import { AuthLayout } from '../layouts/AuthLayout';
import { authClient } from './betterAuthClient';

export interface ContinuePageProps {
  /** Where to navigate after a successful sign-in. */
  homePath: string;
}

/**
 * Magic-link landing page (`/auth/continue?email=&otp=`). The emailed link carries
 * the one-time code in the query string; this verifies it via Better Auth's
 * emailOTP sign-in, then redirects into the app. A ref guards against React
 * StrictMode's double-invoke consuming the single-use code twice.
 */
export function ContinuePage({ homePath }: ContinuePageProps) {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const startedRef = useRef(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    const email = (searchParams.get('email') ?? '').trim().toLowerCase();
    const otp = searchParams.get('otp') ?? '';
    if (!email || !otp) {
      setError('Lien invalide ou expiré.');
      return;
    }

    void (async () => {
      try {
        const { error: verifyError } = await authClient.signIn.emailOtp({ email, otp });
        if (verifyError) {
          setError('Lien invalide ou expiré. Veuillez recommencer la connexion.');
          return;
        }
        navigate(homePath, { replace: true });
      } catch {
        setError('Une erreur est survenue. Veuillez réessayer.');
      }
    })();
  }, [searchParams, navigate, homePath]);

  return (
    <AuthLayout
      title="Connexion"
      subtitle="Vérification de votre lien…"
      brandingPosition="left"
      colorScheme="primary"
    >
      <div className="flex flex-col items-center gap-4 text-center">
        {error ? (
          <>
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
            <Button variant="outline" onClick={() => navigate('/login', { replace: true })}>
              Retour à la connexion
            </Button>
          </>
        ) : (
          <>
            <Spinner size="lg" />
            <p className="text-sm text-soft">Connexion en cours…</p>
          </>
        )}
      </div>
    </AuthLayout>
  );
}
