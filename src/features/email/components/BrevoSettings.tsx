import { Card, Input, Label } from '@crm/design-system';
import type { Draft, SetDraftField, StoredEmailConfig } from '../types';
import { EmailEnableToggle } from './EmailEnableToggle';
import { SecretField } from './SecretField';

interface BrevoSettingsProps {
  draft: Draft;
  email: StoredEmailConfig;
  isSmtp: boolean;
  set: SetDraftField;
}

export function BrevoSettings({ draft, email, isSmtp, set }: BrevoSettingsProps) {
  return (
    <>
      <Card className="space-y-3 p-6">
        <EmailEnableToggle
          label="Utiliser Brevo pour l'envoi d'e-mails"
          checked={!isSmtp}
          onEnable={() => set('provider', 'brevo')}
        />
        <p className="text-xs text-muted-foreground">
          Un seul fournisseur d'e-mail est actif à la fois. Les SMS passent toujours par Brevo, quel
          que soit le fournisseur d'e-mail.
        </p>
      </Card>

      <Card className="space-y-5 p-6">
        <div>
          <h2 className="text-sm font-semibold text-ink">Compte Brevo</h2>
          <p className="text-xs text-muted-foreground">
            Utilisé pour les SMS et, si Brevo est activé ci-dessus, pour l'e-mail et son suivi.
          </p>
        </div>
        <SecretField
          label="Clé API Brevo"
          value={draft.brevoApiKey}
          hasStored={email.hasBrevoApiKey}
          onChange={(v) => set('brevoApiKey', v)}
        />
        <SecretField
          label="Secret du webhook Brevo"
          value={draft.brevoWebhookSecret}
          hasStored={email.hasBrevoWebhookSecret}
          onChange={(v) => set('brevoWebhookSecret', v)}
          hint="Authentifie les webhooks d'événements (ouvertures, clics, rebonds, STOP SMS)."
        />
        <div className="space-y-1.5">
          <Label htmlFor="brevo-sms-sender">Expéditeur SMS</Label>
          <Input
            id="brevo-sms-sender"
            value={draft.brevoSmsSender}
            maxLength={11}
            onChange={(e) => set('brevoSmsSender', e.target.value)}
            placeholder="ex. FabulousCRM (11 caractères max)"
          />
        </div>
      </Card>
    </>
  );
}
