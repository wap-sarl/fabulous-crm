import { Button, Card, StatusBadge } from '@crm/design-system';
import { Blocks } from 'lucide-react';
import { PLUGIN_ICONS } from '../lib/icons';
import type { PluginRow } from '../types';

interface PluginCardProps {
  plugin: PluginRow;
  busy: boolean;
  onInstall: () => void;
  onUninstall: () => void;
}

/** One plugin of the catalogue: what it does, whether it is installed, the one button that changes that. */
export function PluginCard({ plugin, busy, onInstall, onUninstall }: PluginCardProps) {
  return (
    <Card className="flex flex-col gap-4 p-5" data-testid="plugin-card" data-plugin={plugin.key}>
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary">
          {PLUGIN_ICONS[plugin.key as keyof typeof PLUGIN_ICONS] ?? (
            <Blocks className="size-5" aria-hidden="true" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-ink">{plugin.name}</p>
            <StatusBadge tone={plugin.installed ? 'green' : 'gray'} withDot>
              {plugin.installed ? 'Installé' : 'Non installé'}
            </StatusBadge>
          </div>
          <p className="mt-1 text-sm text-soft">{plugin.description}</p>
        </div>
      </div>
      <div className="flex justify-end">
        {plugin.installed ? (
          <Button variant="outline" onClick={onUninstall} disabled={busy}>
            Désinstaller
          </Button>
        ) : (
          <Button onClick={onInstall} disabled={busy}>
            Installer
          </Button>
        )}
      </div>
    </Card>
  );
}
