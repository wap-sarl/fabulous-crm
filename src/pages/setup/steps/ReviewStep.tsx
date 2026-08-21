import { KeyValueList, KeyValueRow } from '@crm/design-system';
import type { StepProps } from './types';

export function ReviewStep({ data, error }: StepProps) {
  const methods = [
    data.magicLinkEnabled ? 'Lien magique' : null,
    ...data.socialProviders.filter((p) => p.enabled).map((p) => p.label),
    ...data.ssoProviders.filter((p) => p.enabled).map((p) => p.label || p.providerId || 'SSO'),
  ].filter(Boolean);

  return (
    <div className="space-y-4">
      <p className="text-sm text-soft">
        Vérifiez la configuration avant de finaliser l'installation.
      </p>
      <KeyValueList>
        <KeyValueRow label="Organisation">{data.organizationName}</KeyValueRow>
        <KeyValueRow label="URL">{data.appUrl}</KeyValueRow>
        <KeyValueRow label="Expéditeur">
          {data.senderName} &lt;{data.senderEmail}&gt;
        </KeyValueRow>
        <KeyValueRow label="Méthodes de connexion">{methods.join(', ') || 'Aucune'}</KeyValueRow>
        {(data.logoPreviewUrl || data.faviconPreviewUrl || data.primaryColor) && (
          <KeyValueRow label="Branding">
            <span className="flex items-center gap-3">
              {data.logoPreviewUrl && (
                <img src={data.logoPreviewUrl} alt="Logo" className="h-8 w-auto object-contain" />
              )}
              {data.faviconPreviewUrl && (
                <img src={data.faviconPreviewUrl} alt="Favicon" className="size-8 object-contain" />
              )}
              {data.primaryColor && (
                <span className="flex items-center gap-1.5">
                  <span
                    className="size-5 rounded-md border border-border"
                    style={{ backgroundColor: data.primaryColor }}
                  />
                  <span className="font-mono text-xs text-soft">{data.primaryColor}</span>
                </span>
              )}
            </span>
          </KeyValueRow>
        )}
        <KeyValueRow label="Administrateur">
          {data.admin.firstName} {data.admin.lastName} &lt;{data.admin.email}&gt;
        </KeyValueRow>
      </KeyValueList>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
