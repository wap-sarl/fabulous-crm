import { useAuth } from '@crm/widgets';
import { PageHeader } from '@crm/design-system';
import { usePageTitle } from '../../layouts/DashboardShell';
import { EmailManager } from '../../features/email/components/EmailManager';

/** Admin-only email/SMS delivery settings: Brevo account + SMTP provider. */
export function EmailPage() {
  usePageTitle('E-mail & SMS');
  const { user } = useAuth();

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-8">
      <PageHeader title="E-mail & SMS" subtitle="Fournisseur d'envoi, clés Brevo et serveur SMTP" />
      <div className="mt-6">
        {user?.access.settings ? (
          <EmailManager />
        ) : (
          <p className="text-sm text-soft">Cette page est réservée aux administrateurs.</p>
        )}
      </div>
    </div>
  );
}
