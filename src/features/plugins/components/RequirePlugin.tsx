import { Link, Outlet } from 'react-router-dom';
import { Card } from '@crm/design-system';
import { useAuth, usePublicConfig } from '@crm/widgets';
import { PLUGINS, type PluginKey } from '@crm/lib/backend';
import { PLUGINS_SETTINGS_PATH } from '../../../lib/navigation';

/** The routes of a plugin open only while it is installed; else a word on it, and the way to the Plugins page for those who may install it. */
export function RequirePlugin({ plugin }: { plugin: PluginKey }) {
  const { config } = usePublicConfig();
  const { user } = useAuth();
  if (!config) return null;
  if (config.plugins.includes(plugin)) return <Outlet />;
  const name = PLUGINS.find((entry) => entry.key === plugin)?.name ?? plugin;
  return (
    <div className="mx-auto w-full max-w-xl px-6 py-12">
      <Card className="p-8 text-center text-sm text-faint" data-testid="plugin-missing">
        <p>Le plugin « {name} » n’est pas installé.</p>
        {user?.access.settings && (
          <p className="mt-2">
            <Link to={PLUGINS_SETTINGS_PATH} className="text-primary hover:underline">
              Ouvrir la page Plugins
            </Link>
          </p>
        )}
      </Card>
    </div>
  );
}
