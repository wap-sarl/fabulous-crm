import { useAuth } from '@crm/widgets';
import { PageHeader } from '@crm/design-system';
import { usePageTitle } from '../../layouts/DashboardShell';
import { RolesManager } from '../../features/access/components/RolesManager';

/** Settings: roles and the access matrix. */
export function RolesPage() {
  usePageTitle('Rôles et accès');
  const { user } = useAuth();
  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-8">
      <PageHeader title="Rôles et accès" subtitle="Qui voit quoi, module par module" />
      <div className="mt-6">
        {user?.access.settings ? (
          <RolesManager />
        ) : (
          <p className="text-sm text-soft">Cette page est réservée aux administrateurs.</p>
        )}
      </div>
    </div>
  );
}
