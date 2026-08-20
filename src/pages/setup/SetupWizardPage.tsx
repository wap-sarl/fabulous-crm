import { useMemo, useState } from 'react';
import { useConvex, useMutation, useQuery } from 'convex/react';
import { useNavigate } from 'react-router-dom';
import { api } from '@crm/lib/backend';
import { zEmailSchema } from '@crm/lib/types';
import { Button, Logo, Progress, Spinner } from '@crm/design-system';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { TokenStep } from './steps/TokenStep';
import { OrganizationStep } from './steps/OrganizationStep';
import { AuthMethodsStep } from './steps/AuthMethodsStep';
import { AdminStep } from './steps/AdminStep';
import { ReviewStep } from './steps/ReviewStep';
import { ssoDraftToConfig, socialDraftToConfig, type WizardData } from './steps/types';

const STEPS = ['Jeton', 'Organisation', 'Connexion', 'Administrateur', 'Récapitulatif'] as const;

const initialData: WizardData = {
  setupToken: '',
  organizationName: '',
  appUrl: '',
  senderEmail: '',
  senderName: '',
  magicLinkEnabled: true,
  ssoProviders: [],
  socialProviders: [],
  admin: { email: '', firstName: '', lastName: '' },
};

export function SetupWizardPage() {
  const navigate = useNavigate();

  const convex = useConvex();
  const setupStatus = useQuery(api.setup.queries.status);
  const completeSetup = useMutation(api.setup.mutations.completeSetup);

  const runVerifyToken = async (token: string): Promise<boolean> => {
    try {
      return await convex.query(api.setup.queries.verifySetupToken, { setupToken: token });
    } catch {
      return false;
    }
  };

  const [step, setStep] = useState(0);
  const [data, setData] = useState<WizardData>({
    ...initialData,
    appUrl: typeof window !== 'undefined' ? window.location.origin : '',
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const update = (patch: Partial<WizardData>) => {
    setData((d) => ({ ...d, ...patch }));
    setError(null);
  };

  const tokenConfigured = setupStatus?.setupTokenConfigured ?? false;

  const validateStep = async (): Promise<boolean> => {
    setError(null);
    switch (step) {
      case 0: {
        if (!tokenConfigured) {
          setError('Définissez SETUP_TOKEN puis rechargez la page.');
          return false;
        }
        if (!data.setupToken.trim()) {
          setError('Veuillez saisir le jeton.');
          return false;
        }
        const ok = await runVerifyToken(data.setupToken);
        if (!ok) {
          setError("Jeton invalide.");
          return false;
        }
        return true;
      }
      case 1: {
        if (!data.organizationName.trim()) return fail("Le nom de l'organisation est requis.");
        if (!/^https?:\/\//.test(data.appUrl.trim())) return fail('URL invalide (http/https requis).');
        if (!zEmailSchema.safeParse(data.senderEmail).success)
          return fail("E-mail de l'expéditeur invalide.");
        if (!data.senderName.trim()) return fail("Le nom de l'expéditeur est requis.");
        return true;
      }
      case 2: {
        const enabledSso = data.ssoProviders.filter((p) => p.enabled);
        const hasSocial = data.socialProviders.some((s) => s.enabled);
        if (!data.magicLinkEnabled && !hasSocial && enabledSso.length === 0)
          return fail('Activez au moins une méthode de connexion.');
        for (const p of enabledSso) {
          if (!p.label.trim()) return fail('Chaque fournisseur SSO doit avoir un libellé.');
          if (!p.providerId.trim()) return fail(`Identifiant (slug) manquant pour "${p.label}".`);
          if (!/^https?:\/\//.test(p.issuerUrl.trim()))
            return fail(`URL d'émetteur invalide pour "${p.label}".`);
          if (!p.clientId.trim()) return fail(`Client ID manquant pour "${p.label}".`);
          if (!p.clientSecret.trim()) return fail(`Client secret manquant pour "${p.label}".`);
        }
        const ids = enabledSso.map((p) => p.providerId);
        if (new Set(ids).size !== ids.length)
          return fail('Les identifiants (slug) des fournisseurs SSO doivent être uniques.');
        return true;
      }
      case 3: {
        if (!data.admin.firstName.trim()) return fail('Prénom requis.');
        if (!data.admin.lastName.trim()) return fail('Nom requis.');
        if (!zEmailSchema.safeParse(data.admin.email).success) return fail('E-mail administrateur invalide.');
        return true;
      }
      default:
        return true;
    }
  };

  const fail = (msg: string) => {
    setError(msg);
    return false;
  };

  const handleNext = async () => {
    setBusy(true);
    try {
      if (await validateStep()) setStep((s) => Math.min(s + 1, STEPS.length - 1));
    } finally {
      setBusy(false);
    }
  };

  const handleBack = () => {
    setError(null);
    setStep((s) => Math.max(s - 1, 0));
  };

  const handleSubmit = async () => {
    setBusy(true);
    setError(null);
    try {
      await completeSetup({
        setupToken: data.setupToken,
        organizationName: data.organizationName,
        appUrl: data.appUrl,
        senderEmail: data.senderEmail,
        senderName: data.senderName,
        auth: {
          magicLinkEnabled: data.magicLinkEnabled,
          ssoProviders: data.ssoProviders
            .filter((d) => d.enabled || d.label.trim() || d.clientId.trim())
            .map(ssoDraftToConfig),
          socialProviders: data.socialProviders
            .filter((d) => d.enabled || d.clientId.trim() || d.clientSecret.trim())
            .map(socialDraftToConfig),
        },
        admin: data.admin,
        ...(data.logoStorageId && { logoStorageId: data.logoStorageId }),
        ...(data.faviconStorageId && { faviconStorageId: data.faviconStorageId }),
        ...(data.primaryColor && { primaryColor: data.primaryColor }),
      });
      // Better Auth owns sessions — the owner signs in on /login (their first
      // login links authId; the gate allows them as an existing employee).
      navigate('/login', { replace: true });
    } catch (e) {
      setError(
        e instanceof Error && e.message.includes('invalid_setup_token')
          ? 'Jeton invalide.'
          : "L'installation a échoué. Veuillez réessayer."
      );
    } finally {
      setBusy(false);
    }
  };

  const stepProps = { data, update, error };
  const progress = useMemo(() => ((step + 1) / STEPS.length) * 100, [step]);

  if (setupStatus === undefined) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  const isLastStep = step === STEPS.length - 1;

  return (
    <div className="flex min-h-screen w-full flex-col bg-canvas">
      <header className="shrink-0 p-6 lg:p-10">
        <Logo
          role="img"
          aria-label={data.organizationName || 'CRM'}
          src={data.logoPreviewUrl}
          label={data.organizationName || undefined}
        />
      </header>

      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-6 pb-16">
        <div className="mb-8 space-y-3">
          <div className="flex items-center justify-between text-sm">
            <span className="font-semibold text-ink">Configuration initiale</span>
            <span className="text-faint">
              Étape {step + 1} / {STEPS.length} · {STEPS[step]}
            </span>
          </div>
          <Progress value={progress} />
        </div>

        <div className="flex-1">
          {step === 0 && <TokenStep {...stepProps} tokenConfigured={tokenConfigured} />}
          {step === 1 && <OrganizationStep {...stepProps} />}
          {step === 2 && <AuthMethodsStep {...stepProps} />}
          {step === 3 && <AdminStep {...stepProps} />}
          {step === 4 && <ReviewStep {...stepProps} />}
        </div>

        <div className="mt-10 flex items-center justify-between">
          <Button variant="ghost" onClick={handleBack} disabled={step === 0 || busy}>
            <ArrowLeft className="mr-2 size-4" aria-hidden="true" />
            Retour
          </Button>
          {isLastStep ? (
            <Button onClick={handleSubmit} loading={busy}>
              Terminer l'installation
            </Button>
          ) : (
            <Button onClick={handleNext} loading={busy} disabled={step === 0 && !tokenConfigured}>
              Continuer
              <ArrowRight className="ml-2 size-4" aria-hidden="true" />
            </Button>
          )}
        </div>
      </main>
    </div>
  );
}
