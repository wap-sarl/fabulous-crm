import { useState } from 'react';
import { useAuthMutation, useAuthQuery } from '@crm/widgets';
import { api } from '@crm/lib/backend';
import { ConfirmDialog, PageHeader, Spinner, toast } from '@crm/design-system';
import { usePageTitle } from '../../layouts/DashboardShell';
import { describeError } from '../../lib/errors';
import { PluginCard } from '../../features/plugins/components/PluginCard';
import type { PluginRow } from '../../features/plugins/types';

/** Settings → Plugins: the optional features, installed or not, each with its button. */
export function PluginsPage() {
  usePageTitle('Plugins');
  const plugins = useAuthQuery(api.features.plugins.queries.listPlugins, {});
  const install = useAuthMutation(api.features.plugins.mutations.installPlugin);
  const uninstall = useAuthMutation(api.features.plugins.mutations.uninstallPlugin);
  const [toUninstall, setToUninstall] = useState<PluginRow | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const onInstall = async (plugin: PluginRow) => {
    setBusy(plugin.key);
    try {
      await install({ key: plugin.key });
      toast.success(`« ${plugin.name} » est installé.`);
    } catch (error) {
      toast.error(describeError(error, 'Échec de l’installation.'));
    } finally {
      setBusy(null);
    }
  };

  const onUninstall = async () => {
    if (!toUninstall) return;
    try {
      await uninstall({ key: toUninstall.key });
      toast.success(`« ${toUninstall.name} » est désinstallé. Ses données sont conservées.`);
    } catch (error) {
      toast.error(describeError(error, 'Échec de la désinstallation.'));
    } finally {
      setToUninstall(null);
    }
  };

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-8">
      <PageHeader
        title="Plugins"
        subtitle="Des fonctionnalités en option, à installer quand l’organisation en a besoin ; désinstaller un plugin le retire du menu et conserve ses données"
      />
      {plugins === undefined ? (
        <Spinner size="sm" />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {plugins.map((plugin) => (
            <PluginCard
              key={plugin.key}
              plugin={plugin}
              busy={busy === plugin.key}
              onInstall={() => onInstall(plugin)}
              onUninstall={() => setToUninstall(plugin)}
            />
          ))}
        </div>
      )}
      <ConfirmDialog
        open={toUninstall !== null}
        onOpenChange={(open) => {
          if (!open) setToUninstall(null);
        }}
        title={`Désinstaller « ${toUninstall?.name ?? ''} » ?`}
        description="Le plugin disparaît du menu et ses adresses publiques ne répondent plus. Ses données sont conservées : une réinstallation les retrouve telles quelles."
        confirmLabel="Désinstaller"
        destructive
        onConfirm={onUninstall}
      />
    </div>
  );
}
