import { Alert, AlertDescription, AlertTitle, Input, Label } from '@crm/design-system';
import { AlertTriangle } from 'lucide-react';
import type { StepProps } from './types';

/**
 * First step. If SETUP_TOKEN isn't set on the deployment the wizard is
 * fail-closed: show the command the operator must run and don't let them past.
 */
export function TokenStep({
  data,
  update,
  error,
  tokenConfigured,
}: StepProps & { tokenConfigured: boolean }) {
  if (!tokenConfigured) {
    return (
      <Alert variant="warning">
        <AlertTriangle className="size-4" aria-hidden="true" />
        <AlertTitle>Jeton d'installation requis</AlertTitle>
        <AlertDescription>
          <p>
            Pour sécuriser la configuration initiale, définissez un jeton sur le déploiement Convex,
            puis rechargez cette page :
          </p>
          <pre className="mt-2 overflow-x-auto rounded bg-secondary p-2 font-mono text-xs">
            bunx convex env set SETUP_TOKEN $(openssl rand -hex 32)
          </pre>
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-soft">
        Saisissez le jeton d'installation (<code>SETUP_TOKEN</code>) défini sur le déploiement pour
        prouver que vous êtes autorisé à configurer cette instance.
      </p>
      <div className="space-y-2">
        <Label htmlFor="setupToken">Jeton d'installation</Label>
        <Input
          id="setupToken"
          type="password"
          size="lg"
          autoComplete="off"
          value={data.setupToken}
          onChange={(e) => update({ setupToken: e.target.value })}
          invalid={!!error}
        />
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>
    </div>
  );
}
