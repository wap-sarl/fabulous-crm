import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from 'convex/react';
import { api } from '@crm/lib/backend';
import type { LegalBasis } from '@crm/lib/backend';
import { Button, Spinner, Switch, toast } from '@crm/design-system';
import { BellOff, CheckCircle } from 'lucide-react';
import { CONSENT_CHANNEL_LABEL } from '../../lib/constants';
import { convexSiteUrl } from '../../lib/convexSite';
import { LEGAL_BASIS_WORDING } from '../../features/subscriptions/lib/constants';

type Choice = Record<string, boolean>;

/** The save goes to the deployment's own route, which keeps the address of the click as a hash on each consent event. */
async function saveChoice(
  token: string,
  body: { types?: Choice; unsubscribeAll?: boolean },
): Promise<'saved' | 'rate_limited' | 'invalid'> {
  const response = await fetch(`${convexSiteUrl()}/consent/${encodeURIComponent(token)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (response.ok) return 'saved';
  return response.status === 429 ? 'rate_limited' : 'invalid';
}

const BASIS_NOTE: Record<LegalBasis, string> = {
  consent: 'Avec votre accord',
  legitimate_interest: 'Intérêt légitime',
};

/** The preference centre: one switch per active subscription with what it is and on what ground, and a way out of everything at once. */
export function ConsentPage() {
  const { token } = useParams<{ token: string }>();
  const consent = useQuery(
    api.features.consent.queries.getConsentByToken,
    token ? { token } : 'skip',
  );

  const [choice, setChoice] = useState<Choice>({});
  const [submitting, setSubmitting] = useState(false);
  const [saved, setSaved] = useState<'kept' | 'none' | null>(null);

  // The switches start from where the person stands.
  useEffect(() => {
    if (consent) {
      setChoice(Object.fromEntries(consent.types.map((t) => [t._id, t.subscribed])));
    }
  }, [consent]);

  const finish = (result: Awaited<ReturnType<typeof saveChoice>>, outcome: 'kept' | 'none') => {
    if (result === 'saved') setSaved(outcome);
    else if (result === 'rate_limited') toast.error('Trop de requêtes, réessayez dans un instant.');
    else toast.error('Ce lien n’est plus valide.');
  };

  const save = async () => {
    if (!token) return;
    setSubmitting(true);
    try {
      const anyOn = Object.values(choice).some(Boolean);
      finish(await saveChoice(token, { types: choice }), anyOn ? 'kept' : 'none');
    } catch {
      toast.error('Une erreur est survenue.');
    } finally {
      setSubmitting(false);
    }
  };

  const unsubscribeAll = async () => {
    if (!token) return;
    setSubmitting(true);
    try {
      finish(await saveChoice(token, { unsubscribeAll: true }), 'none');
      setChoice((prev) => Object.fromEntries(Object.keys(prev).map((id) => [id, false])));
    } catch {
      toast.error('Une erreur est survenue.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-8 shadow-card">
        {consent === undefined ? (
          <div className="flex justify-center py-8">
            <Spinner size="lg" />
          </div>
        ) : consent === null ? (
          <div className="text-center">
            <h1 className="text-lg font-semibold">Lien invalide</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Ce lien de préférences n’est pas valide ou a expiré.
            </p>
          </div>
        ) : saved ? (
          <div className="flex flex-col items-center gap-3 text-center">
            {saved === 'none' ? (
              <>
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted">
                  <BellOff className="h-7 w-7 text-muted-foreground" />
                </div>
                <h1 className="text-lg font-bold text-ink">Désinscription confirmée</h1>
                <p className="text-sm text-muted-foreground">
                  Vous ne recevrez plus nos communications marketing.
                </p>
              </>
            ) : (
              <>
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-success-soft">
                  <CheckCircle className="h-7 w-7 text-success" />
                </div>
                <h1 className="text-lg font-bold text-ink">Préférences enregistrées</h1>
                <p className="text-sm text-muted-foreground">
                  Merci, vos préférences de communication ont été mises à jour.
                </p>
              </>
            )}
            <Button variant="ghost" className="mt-2" onClick={() => setSaved(null)}>
              Modifier à nouveau
            </Button>
          </div>
        ) : (
          <>
            <h1 className="text-lg font-bold text-ink">Vos préférences de communication</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Bonjour {consent.firstName} {consent.lastName}, choisissez ce que vous souhaitez
              recevoir de notre part.
            </p>
            {consent.types.length === 0 ? (
              <p className="mt-6 text-sm text-muted-foreground">
                {consent.marketingConsent.length > 0
                  ? `Vous êtes inscrit par ${consent.marketingConsent
                      .map((c) => CONSENT_CHANNEL_LABEL[c].toLowerCase())
                      .join(', ')}.`
                  : 'Vous n’êtes inscrit à aucune de nos communications.'}
              </p>
            ) : (
              <ul className="mt-6 flex flex-col gap-3">
                {consent.types.map((type) => (
                  <li
                    key={type._id}
                    className="flex items-start justify-between gap-4 rounded-lg border border-input p-3"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-ink">
                        {type.name}
                        <span className="ml-2 text-xs font-normal text-faint">
                          {CONSENT_CHANNEL_LABEL[type.channel]} · {BASIS_NOTE[type.legalBasis]}
                        </span>
                      </p>
                      {type.description && (
                        <p className="mt-0.5 text-sm text-muted-foreground">{type.description}</p>
                      )}
                      <p className="mt-1 text-xs text-faint">
                        {LEGAL_BASIS_WORDING[type.legalBasis]}
                      </p>
                    </div>
                    <Switch
                      checked={choice[type._id] ?? false}
                      onCheckedChange={(on) => setChoice((prev) => ({ ...prev, [type._id]: on }))}
                      aria-label={type.name}
                    />
                  </li>
                ))}
              </ul>
            )}
            {consent.types.length > 0 && (
              <Button className="mt-6 w-full" onClick={save} loading={submitting}>
                Enregistrer mes préférences
              </Button>
            )}
            <Button
              variant="outline"
              className="mt-3 w-full"
              onClick={unsubscribeAll}
              disabled={submitting}
            >
              Tout désinscrire
            </Button>
            <p className="mt-4 text-xs text-faint">
              Chaque changement est daté et conservé avec votre adresse IP, sous forme hachée, pour
              attester de votre choix.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
