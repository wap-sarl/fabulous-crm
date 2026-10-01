import { Card, Input, Label, Switch } from '@crm/design-system';
import type { Draft, SetDraftField, StoredEmailConfig } from '../types';
import { EmailEnableToggle } from './EmailEnableToggle';
import { SecretField } from './SecretField';

interface SmtpSettingsProps {
  draft: Draft;
  email: StoredEmailConfig;
  isSmtp: boolean;
  set: SetDraftField;
}

export function SmtpSettings({ draft, email, isSmtp, set }: SmtpSettingsProps) {
  return (
    <>
      <Card className="space-y-3 p-6">
        <EmailEnableToggle
          label="Utiliser SMTP pour l'envoi d'e-mails"
          checked={isSmtp}
          onEnable={() => set('provider', 'smtp')}
        />
        {isSmtp ? (
          <p className="text-xs text-warning">
            En mode SMTP : les modèles Brevo, le suivi des ouvertures/clics/remises et les rebonds
            ne sont pas disponibles. Les liens de suivi restent fonctionnels.
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            Configurez le serveur ci-dessous, puis activez SMTP pour l'utiliser à la place de Brevo
            pour l'e-mail.
          </p>
        )}
      </Card>

      <Card className="space-y-5 p-6">
        <div>
          <h2 className="text-sm font-semibold text-ink">Serveur SMTP</h2>
          <p className="text-xs text-muted-foreground">
            L'adresse d'expéditeur est celle configurée ci-dessus (« Expéditeur des e-mails »).
          </p>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="smtp-host">Hôte</Label>
            <Input
              id="smtp-host"
              value={draft.smtpHost}
              onChange={(e) => set('smtpHost', e.target.value)}
              placeholder="smtp.example.com"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="smtp-port">Port</Label>
            <Input
              id="smtp-port"
              type="number"
              value={draft.smtpPort}
              onChange={(e) => set('smtpPort', e.target.value)}
              placeholder="587"
            />
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Switch
            checked={draft.smtpSecure}
            onCheckedChange={(v) => set('smtpSecure', v)}
            aria-label="TLS implicite"
          />
          <div>
            <span className="text-sm font-medium text-ink">TLS implicite (port 465)</span>
            <p className="text-xs text-muted-foreground">
              Activé pour le port 465 ; désactivé pour STARTTLS (587/25).
            </p>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="smtp-user">Utilisateur</Label>
            <Input
              id="smtp-user"
              autoComplete="off"
              value={draft.smtpUser}
              onChange={(e) => set('smtpUser', e.target.value)}
              placeholder="Laisser vide pour un relais sans authentification"
            />
          </div>
          <SecretField
            label="Mot de passe"
            value={draft.smtpPass}
            hasStored={email.hasSmtpPass}
            onChange={(v) => set('smtpPass', v)}
          />
        </div>
      </Card>
    </>
  );
}
