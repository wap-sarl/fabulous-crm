import { Card, PageHeader } from '@crm/design-system';
import { usePageTitle } from '../../layouts/DashboardShell';
import { ChannelPluginSettings } from '../../features/notifications/components/ChannelPluginSettings';

/** The Discord plugin's page, for the settings right: how a person connects a channel of theirs, what leaves the CRM, a test. */
export function DiscordSettingsPage() {
  usePageTitle('Discord');
  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-8">
      <PageHeader
        title="Discord"
        subtitle="Les notifications du CRM dans Discord, pour les personnes qui le choisissent"
      />
      <div className="mt-6 space-y-6">
        <Card className="px-5 py-4">
          <h2 className="text-[15px] font-bold text-ink">Comment chacun se connecte</h2>
          <p className="mt-2 text-sm text-soft">
            Un webhook Discord écrit dans un salon, jamais en message privé : chaque personne crée
            un salon textuel privé, visible d’elle seule, et y reçoit ses notifications. Les
            administrateurs d’un serveur voient tous ses salons, leurs webhooks et leurs messages :
            prenez un serveur dont vous êtes seul administrateur, ou acceptez qu’ils le voient.
          </p>
          <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-sm text-soft">
            <li>
              Dans Discord, créer un salon textuel sur son serveur, et dans ses permissions ne
              laisser la lecture qu’à soi (un salon privé).
            </li>
            <li>
              Ouvrir les paramètres du salon, « Intégrations », « Webhooks », « Nouveau webhook »,
              puis « Copier l’URL du webhook ».
            </li>
            <li>
              Coller l’URL obtenue, de la forme https://discord.com/api/webhooks/…, dans Paramètres
              → Notifications, à la ligne Discord.
            </li>
          </ol>
          <p className="mt-3 text-sm text-soft">
            Chaque personne a son propre webhook : l’URL est chiffrée, jamais réaffichée, et qui la
            possède peut écrire dans le salon choisi. Les messages ne mentionnent personne.
          </p>
        </Card>
        <ChannelPluginSettings channel="discord" />
      </div>
    </div>
  );
}
