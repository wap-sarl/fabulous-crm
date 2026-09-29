import { useAuth } from '@crm/widgets';
import { PageHeader } from '@crm/design-system';
import { usePageTitle } from '../../layouts/DashboardShell';
import { FilesManager } from '../../features/attachments/components/FilesManager';

/** Admin-only settings: attachment limits. */
export function FilesPage() {
  usePageTitle('Fichiers');
  const { user } = useAuth();
  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-8">
      <PageHeader title="Fichiers" subtitle="Pièces jointes des fiches" />
      <div className="mt-6">
        {user?.access.settings ? (
          <FilesManager />
        ) : (
          <p className="text-sm text-soft">Cette page est réservée aux administrateurs.</p>
        )}
      </div>
    </div>
  );
}
