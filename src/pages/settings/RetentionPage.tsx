import { useAuth } from '@crm/widgets';
import { PageHeader } from '@crm/design-system';
import { usePageTitle } from '../../layouts/DashboardShell';
import { RetentionManager } from '../../features/retention/components/RetentionManager';

/** Admin-only settings: how long deleted records, events and the audit journal are kept. */
export function RetentionPage() {
  usePageTitle('Conservation');
  const { user } = useAuth();
  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-8">
      <PageHeader title="Conservation" subtitle="Durées de conservation et purge nocturne" />
      <div className="mt-6">
        {user?.access.settings ? (
          <RetentionManager />
        ) : (
          <p className="text-sm text-soft">Cette page est réservée aux administrateurs.</p>
        )}
      </div>
    </div>
  );
}
