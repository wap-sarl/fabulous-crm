import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
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
import { Link2, Milestone, Pencil, Phone } from 'lucide-react';
import { usePageTitle } from '../../layouts/DashboardShell';
import { formatAddress } from '../../lib/addresses';
import { CONSENT_CHANNEL_LABEL } from '../../lib/constants';
import { LeadFormDialog } from '../../features/leads/components/LeadFormDialog';
import { LeadNotes } from '../../features/leads/components/LeadNotes';
import { usePropertyDefinitions } from '../../features/properties/hooks/usePropertyDefinitions';
import { useLifecycleConfig } from '../../features/leads/hooks/useLifecycleConfig';
import { LeadLifecycleCard } from '../../features/leads/components/LeadLifecycleCard';
import { EntityDealsCard } from '../../features/deals/components/EntityDealsCard';
import { EntityActivitiesCard } from '../../features/activities/components/EntityActivitiesCard';
import { LogCallDialog } from '../../features/activities/components/ActivityDialogs';
import { LeadTimeline } from '../../features/timeline/components/LeadTimeline';
import { EntityAttachmentsCard } from '../../features/attachments/components/EntityAttachmentsCard';
import {
  formatPropertyValue,
  hasPropertyValue,
} from '../../features/properties/lib/customProperties';

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

export function LeadDetailPage() {
  usePageTitle('Lead');
  const navigate = useNavigate();
  const { leadId } = useParams<{ leadId: string }>();
  const data = useAuthQuery(
    api.features.crm.queries.getLeadDetail,
    leadId ? { leadId: leadId as Id<'leads'> } : 'skip',
  );

  const [editOpen, setEditOpen] = useState(false);
  const [callOpen, setCallOpen] = useState(false);
  const propertyDefinitions = usePropertyDefinitions('lead');
  const lifecycle = useLifecycleConfig();

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

  const { lead, assignedToName, company } = data;
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
          <span className="flex flex-wrap items-center gap-1.5">
            <StatusBadge tone="violet" withDot={false}>
              <Milestone className="size-3" aria-hidden />
              {lifecycle.labelOf(lead.lifecycleStage)}
            </StatusBadge>
          </span>
        }
        subtitle={[lead.email, lead.phone].filter(Boolean).join(' · ') || 'Aucune coordonnée'}
        actions={
          <>
            <Button
              variant="outline"
              onClick={() => setCallOpen(true)}
              data-testid="log-call-header"
            >
              <Phone className="h-4 w-4" />
              Consigner un appel
            </Button>
            <Button variant="outline" onClick={() => setEditOpen(true)}>
              <Pencil className="h-4 w-4" />
              Modifier
            </Button>
          </>
        }
      />

      <div className="mx-auto grid w-full max-w-[1180px] grid-cols-1 gap-5 px-5 py-5 sm:px-7 lg:grid-cols-[minmax(0,1fr)_400px]">
        {/* Main column */}
        <div className="flex flex-col gap-5">
          <Card className="p-5">
            <h2 className="mb-2 text-[15px] font-bold text-ink">Détails</h2>
            <KeyValueList>
              <KeyValueRow label="Entreprise">
                {company ? (
                  <Link
                    to={`/companies/${company._id}`}
                    className="text-primary hover:underline"
                    data-testid="lead-company-link"
                  >
                    {company.name}
                  </Link>
                ) : (
                  '—'
                )}
              </KeyValueRow>
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

          <LeadTimeline leadId={lead._id} />
        </div>

        {/* Aside column */}
        <div className="flex flex-col gap-5">
          <LeadLifecycleCard leadId={lead._id} currentStage={lead.lifecycleStage} />

          <EntityActivitiesCard leadId={lead._id} />

          <EntityDealsCard leadId={lead._id} leadName={fullName} />

          <LeadNotes leadId={lead._id} />

          <EntityAttachmentsCard entityType="lead" entityId={lead._id} />

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
        </div>
      </div>

      <LogCallDialog open={callOpen} onOpenChange={setCallOpen} links={{ leadId: lead._id }} />
      <LeadFormDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        lead={{ ...lead, companyName: company?.name ?? null }}
      />
    </div>
  );
}
