import { Card, PageHeader } from '@crm/design-system';
import { usePageTitle } from '../../layouts/DashboardShell';
import { ChannelPluginSettings } from '../../features/notifications/components/ChannelPluginSettings';

/** The Slack plugin's page, for the settings right: how a person connects their Slack, what leaves the CRM, a test. */
export function SlackSettingsPage() {
  usePageTitle('Slack');
  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-8">
      <PageHeader
        title="Slack"
        subtitle="Les notifications du CRM dans Slack, pour les personnes qui le choisissent"
      />
      <div className="mt-6 space-y-6">
        <Card className="px-5 py-4">
          <h2 className="text-[15px] font-bold text-ink">Comment chacun se connecte</h2>
          <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-sm text-soft">
            <li>
              Dans Slack, créer une application sur{' '}
              <a
                href="https://api.slack.com/apps"
                target="_blank"
                rel="noreferrer"
                className="text-primary hover:underline"
              >
                api.slack.com/apps
              </a>{' '}
              (« Create New App », « From scratch »), puis y activer « Incoming Webhooks ».
            </li>
            <li>
              « Add New Webhook to Workspace » : choisir la conversation où écrire, un canal ou sa
              propre messagerie directe.
            </li>
            <li>
              Copier l’URL obtenue, de la forme https://hooks.slack.com/services/…, et la coller
              dans Paramètres → Notifications, à la ligne Slack.
            </li>
          </ol>
          <p className="mt-3 text-sm text-soft">
            Chaque personne a son propre webhook : l’URL est chiffrée, jamais réaffichée, et qui la
            possède peut écrire dans la conversation choisie.
          </p>
        </Card>
        <ChannelPluginSettings channel="slack" />
      </div>
    </div>
  );
}
