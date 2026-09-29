import { useAuth } from '@crm/widgets';
import { PageHeader } from '@crm/design-system';
import { usePageTitle } from '../../layouts/DashboardShell';
import { TeamManager } from '../../features/teams/components/TeamManager';

/** Admin-only team management: members + pending invitations + invite form. */
export function TeamPage() {
  usePageTitle('Équipe');
  const { user } = useAuth();

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-8">
      <PageHeader title="Équipe" subtitle="Gérez les membres et les invitations" />
      <div className="mt-6">
        {user?.access.settings ? (
          <TeamManager />
        ) : (
          <p className="text-sm text-soft">Cette page est réservée aux administrateurs.</p>
        )}
      </div>
    </div>
  );
}
