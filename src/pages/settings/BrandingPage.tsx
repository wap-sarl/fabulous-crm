import { useAuth } from '@crm/widgets';
import { PageHeader } from '@crm/design-system';
import { usePageTitle } from '../../layouts/DashboardShell';
import { BrandingManager } from '../../features/branding/components/BrandingManager';

/** Admin-only branding settings: upload/replace the logo and favicon. */
export function BrandingPage() {
  usePageTitle('Apparence');
  const { user } = useAuth();

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-8">
      <PageHeader title="Apparence" subtitle="Personnalisez le logo et le favicon" />
      <div className="mt-6">
        {user?.access.settings ? (
          <BrandingManager />
        ) : (
          <p className="text-sm text-soft">Cette page est réservée aux administrateurs.</p>
        )}
      </div>
    </div>
  );
}
