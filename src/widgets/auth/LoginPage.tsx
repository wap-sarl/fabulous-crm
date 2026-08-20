import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button, Input, Label, OtpInput } from '@crm/design-system';
import { zEmailSchema } from '@crm/lib/types';
import { CheckCircle, Mail, ArrowLeft } from 'lucide-react';
import { AuthLayout } from '../layouts/AuthLayout';
import { usePublicConfig } from '../config';
import { authClient, isSocialProvider } from './betterAuthClient';
import { ProviderIcon } from './providerIcons';

const GENERIC_ERROR = 'Une erreur est survenue. Veuillez réessayer.';

/** Map a Better Auth error to a user-facing French message. */
function messageForError(err: { code?: string; message?: string } | null): string {
  const code = err?.code ?? err?.message ?? '';
  if (code === 'not_invited' || code === 'FORBIDDEN')
    return "Cette adresse n'est pas autorisée. Demandez une invitation à un administrateur.";
  if (code.includes('OTP') || code.includes('otp') || code === 'INVALID_OTP')
    return 'Code incorrect ou expiré. Veuillez réessayer.';
  return GENERIC_ERROR;
}

export interface LoginPageProps {
  /** Where to navigate after a successful login. */
  homePath: string;
  title?: string;
  subtitle?: string;
}

export function LoginPage({
  homePath,
  title = 'Bon retour',
  subtitle = 'Connectez-vous à votre espace de gestion',
}: LoginPageProps) {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [resendSuccess, setResendSuccess] = useState(false);
  const [otpValue, setOtpValue] = useState('');
  const [otpError, setOtpError] = useState<string | null>(null);
  const [isVerifyingOtp, setIsVerifyingOtp] = useState(false);
  const [socialLoadingId, setSocialLoadingId] = useState<string | null>(null);

  const { config } = usePublicConfig();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const magicLinkEnabled = config?.auth.magicLink ?? true;
  const socialProviders = config?.auth.socialProviders.filter((p) => p.configured) ?? [];
  const ssoProviders = config?.auth.customSsoProviders ?? [];
  const hasOauthProvider = socialProviders.length > 0 || ssoProviders.length > 0;

  // Surface an error returned from a failed social redirect (errorCallbackURL).
  const urlError = searchParams.get('error');

  const handleSocialLogin = async (providerId: string) => {
    if (!isSocialProvider(providerId)) return;
    setError(null);
    setSocialLoadingId(providerId);
    try {
      await authClient.signIn.social({
        provider: providerId,
        // MUST be absolute — a relative URL resolves against the Better Auth
        // baseURL (the .convex.site origin) instead of the SPA.
        callbackURL: `${window.location.origin}/`,
        // Let Better Auth set the real `error` code on this URL (it overwrites
        // the `error` param). Hardcoding one here masked every failure as
        // "not_invited"; the gate throws `not_invited`/`FORBIDDEN` itself.
        errorCallbackURL: `${window.location.origin}/login`,
      });
    } catch {
      setError('Impossible de démarrer la connexion. Veuillez réessayer.');
      setSocialLoadingId(null);
    }
  };

  const handleSsoLogin = async (providerId: string) => {
    setError(null);
    setSocialLoadingId(providerId);
    try {
      await authClient.signIn.oauth2({
        providerId,
        // MUST be absolute — a relative URL resolves against the Better Auth
        // baseURL (the .convex.site origin) instead of the SPA.
        callbackURL: `${window.location.origin}/`,
        // See handleSocialLogin: don't hardcode the error — let Better Auth
        // report the real code so failures aren't all shown as "not_invited".
        errorCallbackURL: `${window.location.origin}/login`,
      });
    } catch {
      setError('Impossible de démarrer la connexion. Veuillez réessayer.');
      setSocialLoadingId(null);
    }
  };

  const sendOtp = async (): Promise<boolean> => {
    const { error: sendError } = await authClient.emailOtp.sendVerificationOtp({
      email: email.trim().toLowerCase(),
      type: 'sign-in',
    });
    if (sendError) {
      setError(messageForError(sendError));
      return false;
    }
    return true;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const result = zEmailSchema.safeParse(email);
    if (!result.success) {
      setError(result.error.issues[0].message);
      return;
    }

    setIsSubmitting(true);
    try {
      if (await sendOtp()) setEmailSent(true);
    } catch {
      setError(GENERIC_ERROR);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResendEmail = async () => {
    setIsResending(true);
    setResendSuccess(false);
    setError(null);
    setOtpValue('');
    setOtpError(null);
    try {
      if (await sendOtp()) setResendSuccess(true);
    } catch {
      setError(GENERIC_ERROR);
    } finally {
      setIsResending(false);
    }
  };

  const handleBackToEmailInput = () => {
    setEmailSent(false);
    setResendSuccess(false);
    setError(null);
    setOtpValue('');
    setOtpError(null);
  };

  const handleOtpComplete = async (code: string) => {
    setIsVerifyingOtp(true);
    setOtpError(null);
    try {
      const { error: verifyError } = await authClient.signIn.emailOtp({
        email: email.trim().toLowerCase(),
        otp: code,
      });
      if (verifyError) {
        setOtpError(messageForError(verifyError));
        setOtpValue('');
        return;
      }
      navigate(homePath, { replace: true });
    } catch {
      setOtpError(GENERIC_ERROR);
      setOtpValue('');
    } finally {
      setIsVerifyingOtp(false);
    }
  };

  // Email-sent confirmation + OTP entry (works same-device or cross-device).
  if (emailSent) {
    return (
      <AuthLayout
        title="E-mail envoyé"
        subtitle="Vérifiez votre boîte de réception"
        brandingPosition="left"
        colorScheme="primary"
      >
        <div className="flex flex-col items-center gap-6 text-center">
          <div className="flex size-12 items-center justify-center rounded-full bg-success-soft text-success">
            <CheckCircle className="size-6" aria-hidden="true" />
          </div>

          <div className="space-y-2">
            <p className="text-ink">Un lien de connexion a été envoyé à :</p>
            <p className="font-medium text-ink" data-testid="sent-email-address">
              {email}
            </p>
          </div>

          <div className="space-y-2 text-sm text-soft">
            <div className="flex items-center justify-center gap-2">
              <Mail className="h-4 w-4" aria-hidden="true" />
              <span>Cliquez sur le lien, ou saisissez le code reçu ci-dessous.</span>
            </div>
          </div>

          <div className="w-full space-y-4">
            <OtpInput
              value={otpValue}
              onChange={setOtpValue}
              onComplete={handleOtpComplete}
              disabled={isVerifyingOtp}
              error={!!otpError}
              autoFocus
            />
            {otpError && (
              <p className="text-sm text-destructive" role="alert" data-testid="otp-error">
                {otpError}
              </p>
            )}
            {isVerifyingOtp && <p className="text-sm text-soft">Vérification en cours...</p>}
          </div>

          {resendSuccess && (
            <p className="text-sm text-success" role="status" data-testid="resend-success">
              E-mail renvoyé avec succès !
            </p>
          )}
          {error && (
            <p className="text-sm text-destructive" role="alert" data-testid="resend-error">
              {error}
            </p>
          )}

          <div className="flex w-full flex-col gap-3">
            <Button
              variant="outline"
              className="w-full"
              onClick={handleResendEmail}
              loading={isResending}
              disabled={isResending || isVerifyingOtp}
              data-testid="resend-email-button"
            >
              Renvoyer l'e-mail
            </Button>
            <Button
              variant="ghost"
              className="w-full"
              onClick={handleBackToEmailInput}
              disabled={isVerifyingOtp}
              data-testid="back-to-login-button"
            >
              <ArrowLeft className="mr-2 h-4 w-4" aria-hidden="true" />
              Modifier l'adresse e-mail
            </Button>
          </div>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title={title} subtitle={subtitle} brandingPosition="left" colorScheme="primary">
      <div className="space-y-5">
        {urlError && !error && (
          <p className="text-center text-sm text-destructive" role="alert">
            {messageForError({ code: urlError })}
          </p>
        )}

        {hasOauthProvider && (
          <div className="space-y-3">
            {socialProviders.map((provider) => (
              <Button
                key={provider.id}
                type="button"
                variant="outline"
                size="lg"
                className="w-full"
                loading={socialLoadingId === provider.id}
                disabled={socialLoadingId !== null}
                onClick={() => handleSocialLogin(provider.id)}
              >
                <ProviderIcon id={provider.id} className="mr-2 size-4" />
                Se connecter avec {provider.label}
              </Button>
            ))}
            {ssoProviders.map((provider) => (
              <Button
                key={provider.id}
                type="button"
                variant="outline"
                size="lg"
                className="w-full"
                loading={socialLoadingId === provider.id}
                disabled={socialLoadingId !== null}
                onClick={() => handleSsoLogin(provider.id)}
              >
                <ProviderIcon id={provider.id} className="mr-2 size-4" />
                Se connecter avec {provider.label}
              </Button>
            ))}
          </div>
        )}

        {hasOauthProvider && magicLinkEnabled && (
          <div className="flex items-center gap-3" aria-hidden="true">
            <span className="h-px flex-1 bg-border" />
            <span className="text-xs text-faint">ou</span>
            <span className="h-px flex-1 bg-border" />
          </div>
        )}

        {magicLinkEnabled && (
          <form className="space-y-5" onSubmit={handleSubmit} noValidate>
            <div className="space-y-2">
              <Label htmlFor="email" className="text-[12.5px] font-semibold text-soft">
                Adresse e-mail
              </Label>
              <Input
                id="email"
                type="email"
                size="lg"
                placeholder="votre@email.fr"
                autoComplete="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  if (error) setError(null);
                }}
                disabled={isSubmitting}
                invalid={!!error}
                aria-invalid={!!error}
                aria-describedby={error ? 'email-error' : undefined}
              />
              {error && (
                <p id="email-error" className="text-sm text-destructive">
                  {error}
                </p>
              )}
            </div>

            <Button type="submit" size="lg" className="w-full" loading={isSubmitting}>
              Recevoir le lien de connexion
            </Button>

            <p className="text-center text-sm text-faint">
              Un lien de connexion sécurisé vous sera envoyé par e-mail.
            </p>
          </form>
        )}

        {!magicLinkEnabled && !hasOauthProvider && (
          <p className="text-center text-sm text-soft">
            Aucune méthode de connexion n'est configurée.
          </p>
        )}
      </div>
    </AuthLayout>
  );
}
