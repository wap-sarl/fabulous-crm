import { useConvex } from 'convex/react';
import { api } from '@crm/lib/backend';
import { Input, Label } from '@crm/design-system';
import { ImageUploadField, ColorPickerField, applyPrimaryColor } from '@crm/widgets/config';
import type { StepProps } from './types';

export function OrganizationStep({ data, update, error }: StepProps) {
  const convex = useConvex();
  const getUploadUrl = () =>
    convex.mutation(api.setup.mutations.generateSetupUploadUrl, {
      setupToken: data.setupToken,
    });

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="organizationName">Nom de l'organisation</Label>
        <Input
          id="organizationName"
          size="lg"
          value={data.organizationName}
          onChange={(e) => update({ organizationName: e.target.value })}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="appUrl">URL de l'application</Label>
        <Input
          id="appUrl"
          size="lg"
          placeholder="https://crm.exemple.fr"
          value={data.appUrl}
          onChange={(e) => update({ appUrl: e.target.value })}
        />
        <p className="text-xs text-faint">
          Utilisée pour les liens de connexion e-mail et l'URL de redirection SSO.
        </p>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="senderName">Nom de l'expéditeur</Label>
          <Input
            id="senderName"
            size="lg"
            value={data.senderName}
            onChange={(e) => update({ senderName: e.target.value })}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="senderEmail">E-mail de l'expéditeur</Label>
          <Input
            id="senderEmail"
            type="email"
            size="lg"
            value={data.senderEmail}
            onChange={(e) => update({ senderEmail: e.target.value })}
          />
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <ImageUploadField
          label="Logo"
          shape="wide"
          hint="PNG ou SVG, fond transparent recommandé."
          currentUrl={data.logoPreviewUrl}
          onGetUploadUrl={getUploadUrl}
          onUploaded={(storageId, previewUrl) =>
            update({ logoStorageId: storageId, logoPreviewUrl: previewUrl })
          }
        />
        <ImageUploadField
          label="Favicon"
          shape="square"
          accept={['image/png', 'image/svg+xml', 'image/x-icon', 'image/vnd.microsoft.icon']}
          hint="PNG, SVG ou ICO carré (32×32 ou plus)."
          currentUrl={data.faviconPreviewUrl}
          onGetUploadUrl={getUploadUrl}
          onUploaded={(storageId, previewUrl) =>
            update({ faviconStorageId: storageId, faviconPreviewUrl: previewUrl })
          }
        />
      </div>
      <ColorPickerField
        label="Couleur d'accentuation"
        hint="Appliquée aux boutons, liens et éléments actifs de l'interface."
        value={data.primaryColor ?? null}
        onChange={(hex) => {
          applyPrimaryColor(hex); // live preview across the wizard
          update({ primaryColor: hex });
        }}
      />
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
