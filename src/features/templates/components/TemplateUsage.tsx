import { useAuthQuery } from '@crm/widgets';
import { api } from '@crm/lib/backend';
import type { Id } from '@crm/lib/backend';
import { Spinner } from '@crm/design-system';

const pct = (n: number, of: number) => (of > 0 ? `${Math.round((n / of) * 100)} %` : '—');

/** Where a template went: its campaigns with their opens and clicks, the workflow steps that load it; a workflow e-mail is not tracked, so it counts and nothing more. */
export function TemplateUsage({ templateId }: { templateId: Id<'emailTemplates'> }) {
  const usage = useAuthQuery(api.features.emailTemplates.queries.getEmailTemplateUsage, {
    templateId,
  });
  if (!usage) return <Spinner size="sm" />;
  return (
    <div className="space-y-2">
      <p className="text-xs text-faint">Dans les campagnes et les workflows de votre périmètre.</p>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-5">
        <Figure label="Campagnes" value={String(usage.campaigns) + (usage.partial ? '+' : '')} />
        <Figure label="Étapes de workflow" value={String(usage.workflows)} />
        <Figure label="Envoyés" value={String(usage.sent)} />
        <Figure label="Ouvertures" value={pct(usage.opened, usage.sent)} />
        <Figure label="Clics" value={pct(usage.clicked, usage.sent)} />
      </dl>
    </div>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-faint">{label}</dt>
      <dd className="font-medium text-ink">{value}</dd>
    </div>
  );
}
