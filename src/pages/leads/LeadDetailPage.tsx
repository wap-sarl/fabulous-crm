import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '@crm/lib/backend';
import type { Id } from '@crm/lib/backend';
import { useAuthQuery } from '@crm/widgets';
import {
  Button,
  Card,
  InitialsAvatar,
  KeyValueList,
  KeyValueRow,
  PageHeader,
  Spinner,
  StatusBadge,
  toast,
} from '@crm/design-system';
import { ChevronRight, Link2, Mail, Pencil } from 'lucide-react';
import { usePageTitle } from '../../layouts/DashboardShell';
import {
  CONSENT_CHANNEL_LABEL,
  LEAD_STATUS_LABEL,
  LEAD_STATUS_TONE,
  SEND_STATUS_LABEL,
} from '../../lib/constants';
import { LeadFormDialog } from '../../features/leads/components/LeadFormDialog';
import { LeadNotes } from '../../features/leads/components/LeadNotes';
import { useLeadPropertyDefinitions } from '../../features/leads/hooks/useLeadPropertyDefinitions';
import { formatPropertyValue, hasPropertyValue } from '../../features/leads/lib/customProperties';

const dateFormat = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium' });
const dateTimeFormat = new Intl.DateTimeFormat('fr-FR', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

const CONSENT_SOURCE_LABEL: Record<string, string> = {
  crm: 'CRM',
  public_link: 'Lien public',
  import: 'Import',
  sms_stop: 'Réponse STOP (SMS)',
};

function formatAddress(address: {
  streetNumber: string;
  street: string;
  postalCode: string;
  city: string;
  country: string;
}): string {
  return `${address.streetNumber} ${address.street}, ${address.postalCode} ${address.city}, ${address.country}`;
}

export function LeadDetailPage() {
  usePageTitle('Lead');
  const navigate = useNavigate();
  const { leadId } = useParams<{ leadId: string }>();
  const data = useAuthQuery(
    api.features.crm.queries.getLeadDetail,
    leadId ? { leadId: leadId as Id<'leads'> } : 'skip'
  );

  const [editOpen, setEditOpen] = useState(false);
  const propertyDefinitions = useLeadPropertyDefinitions();

  if (data === undefined) {
    return (
      <div className="flex justify-center py-12">
        <Spinner size="lg" />
      </div>
    );
  }

  if (data === null) {
    return <p className="p-7 text-faint">Lead introuvable.</p>;
  }

  const { lead, assignedToName, campaigns } = data;
  const fullName = `${lead.firstName} ${lead.lastName}`;

  const copyConsentLink = async () => {
    const url = `${window.location.origin}/consent/${lead.consentToken}`;
    try {
      await navigator.clipboard.writeText(url);
      toast.success('Lien de consentement copié.');
    } catch {
      toast.error('Impossible de copier le lien.');
    }
  };

  return (
    <div className="flex flex-col">
      <PageHeader
        onBack={() => navigate('/leads')}
        leading={<InitialsAvatar name={fullName} size={46} />}
        title={fullName}
        titleExtra={
          <StatusBadge tone={LEAD_STATUS_TONE[lead.status]}>
            {LEAD_STATUS_LABEL[lead.status]}
          </StatusBadge>
        }
        subtitle={[lead.email, lead.phone].filter(Boolean).join(' · ') || 'Aucune coordonnée'}
        actions={
          <Button variant="outline" onClick={() => setEditOpen(true)}>
            <Pencil className="h-4 w-4" />
            Modifier
          </Button>
        }
      />

      <div className="mx-auto grid w-full max-w-[1180px] grid-cols-1 gap-5 px-5 py-5 sm:px-7 lg:grid-cols-[minmax(0,1fr)_400px]">
        {/* Main column */}
        <div className="flex flex-col gap-5">
          <Card className="p-5">
            <h2 className="mb-2 text-[15px] font-bold text-ink">Détails</h2>
            <KeyValueList>
              <KeyValueRow label="Assigné à">{assignedToName ?? '—'}</KeyValueRow>
              <KeyValueRow label="E-mail">{lead.email ?? '—'}</KeyValueRow>
              <KeyValueRow label="Téléphone" mono>
                {lead.phone ?? '—'}
              </KeyValueRow>
              <KeyValueRow label="Adresse">
                {lead.address ? formatAddress(lead.address) : '—'}
              </KeyValueRow>
              <KeyValueRow label="Créé le" mono>
                {dateFormat.format(lead._creationTime)}
              </KeyValueRow>
              <KeyValueRow label="Signalé">{lead.isRedFlagged ? 'Oui' : 'Non'}</KeyValueRow>
              {propertyDefinitions
                .filter((def) => hasPropertyValue(lead.customProperties?.[def._id]))
                .map((def) => (
                  <KeyValueRow key={def._id} label={def.label}>
                    {formatPropertyValue(def, lead.customProperties?.[def._id])}
                  </KeyValueRow>
                ))}
            </KeyValueList>
          </Card>

          {lead.comment && (
            <Card className="p-5">
              <h2 className="mb-2 text-[15px] font-bold text-ink">Commentaire</h2>
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-body">
                {lead.comment}
              </p>
            </Card>
          )}
        </div>

        {/* Aside column */}
        <div className="flex flex-col gap-5">
          <LeadNotes leadId={lead._id} />

          <Card className="p-5">
            <h2 className="mb-2 text-[15px] font-bold text-ink">Consentement marketing</h2>
            {lead.marketingConsent.length > 0 ? (
              <div className="mb-1 flex flex-wrap gap-1.5">
                {lead.marketingConsent.map((c) => (
                  <span
                    key={c}
                    className="rounded-md bg-success-soft px-2 py-1 text-xs font-medium text-success"
                  >
                    {CONSENT_CHANNEL_LABEL[c]}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-sm text-faint">Aucun consentement.</p>
            )}
            <KeyValueList>
              <KeyValueRow label="Mis à jour le" mono>
                {lead.consentUpdatedAt ? dateTimeFormat.format(lead.consentUpdatedAt) : '—'}
              </KeyValueRow>
              <KeyValueRow label="Source">
                {lead.consentSource ? (CONSENT_SOURCE_LABEL[lead.consentSource] ?? '—') : '—'}
              </KeyValueRow>
            </KeyValueList>
            <Button variant="ghost" className="mt-2 w-full" onClick={copyConsentLink}>
              <Link2 className="h-4 w-4" />
              Copier le lien de consentement
            </Button>
          </Card>

          <Card className="p-5">
            <h2 className="mb-3 text-[15px] font-bold text-ink">Campagnes</h2>
            {campaigns.length === 0 ? (
              <p className="text-sm text-faint">Aucune campagne.</p>
            ) : (
              <ul className="flex flex-col">
                {campaigns.map((c) => (
                  <li key={`${c.campaignId}`}>
                    <button
                      type="button"
                      onClick={() => navigate(`/campaigns/${c.campaignId}`)}
                      className="flex w-full cursor-pointer items-center gap-3 rounded-lg px-2 py-2.5 text-left transition-colors hover:bg-[#F7F8FA]"
                    >
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-[#EFEBFE] text-[#6A4BF0]">
                        <Mail className="size-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-semibold text-ink">
                          {c.name}
                        </span>
                        <span className="block truncate text-xs text-faint">
                          {SEND_STATUS_LABEL[c.sendStatus]}
                          {c.sentAt ? ` · ${dateFormat.format(c.sentAt)}` : ''}
                        </span>
                      </span>
                      <ChevronRight className="size-4 shrink-0 text-[#C8CCD4]" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>

      <LeadFormDialog open={editOpen} onOpenChange={setEditOpen} lead={lead} />
    </div>
  );
}
