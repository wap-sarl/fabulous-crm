import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation } from 'convex/react';
import { api } from '@crm/lib/backend';
import type { MarketingConsentChannel } from '@crm/lib/backend';
import { Button, Checkbox, Spinner, toast } from '@crm/design-system';
import { BellOff, CheckCircle } from 'lucide-react';
import { CONSENT_CHANNELS } from '../../lib/constants';

export function ConsentPage() {
  const { token } = useParams<{ token: string }>();
  const consent = useQuery(api.features.crm.queries.getConsentByToken, token ? { token } : 'skip');
  const updateConsent = useMutation(api.features.crm.mutations.updateConsentByToken);

  const [channels, setChannels] = useState<MarketingConsentChannel[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [saved, setSaved] = useState(false);

  // Seed local state once the lead's current consent loads
  useEffect(() => {
    if (consent) setChannels(consent.marketingConsent);
  }, [consent]);

  const toggle = (channel: MarketingConsentChannel, checked: boolean) =>
    setChannels((prev) => (checked ? [...prev, channel] : prev.filter((c) => c !== channel)));

  const allChannels = CONSENT_CHANNELS.map((c) => c.value);

  // `override` lets the accept-all / refuse-all buttons save an explicit set
  // without waiting for a checkbox state update to flush.
  const handleSave = async (override?: MarketingConsentChannel[]) => {
    if (!token) return;
    const toSave = override ?? channels;
    setSubmitting(true);
    try {
      const result = await updateConsent({ token, channels: toSave });
      if (result.success) {
        setChannels(toSave);
        setSaved(true);
      } else {
        toast.error('Ce lien n’est plus valide.');
      }
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
            {channels.length === 0 ? (
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
          </div>
        ) : (
          <>
            <h1 className="text-lg font-bold text-ink">Vos préférences de communication</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Bonjour {consent.firstName} {consent.lastName}, choisissez les canaux par lesquels
              nous pouvons vous contacter.
            </p>
            <div className="mt-6 flex flex-col gap-3">
              {CONSENT_CHANNELS.map((channel) => (
                <label
                  key={channel.value}
                  className="flex cursor-pointer items-center gap-3 rounded-lg border border-input p-3 text-sm transition-colors has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary-soft/40"
                >
                  <Checkbox
                    checked={channels.includes(channel.value)}
                    onCheckedChange={(c) => toggle(channel.value, c === true)}
                  />
                  {channel.label}
                </label>
              ))}
            </div>
            <Button className="mt-6 w-full" onClick={() => handleSave()} loading={submitting}>
              Enregistrer mes préférences
            </Button>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <Button
                variant="outline"
                onClick={() => handleSave(allChannels)}
                disabled={submitting}
              >
                Tout accepter
              </Button>
              <Button
                variant="outline"
                onClick={() => handleSave([])}
                disabled={submitting}
              >
                Tout refuser
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
