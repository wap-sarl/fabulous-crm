import { PageHeader } from '@crm/design-system';
import { usePageTitle } from '../../layouts/DashboardShell';
import { NotificationPreferences } from '../../features/notifications/components/NotificationPreferences';

/** Every employee's own settings: what they are told about, and where. */
export function NotificationSettingsPage() {
  usePageTitle('Notifications');
  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-8">
      <PageHeader
        title="Notifications"
        subtitle="Ce dont vous êtes informé·e, et où : ces réglages sont les vôtres, ils ne changent rien pour vos collègues"
      />
      <div className="mt-6">
        <NotificationPreferences />
      </div>
    </div>
  );
}
