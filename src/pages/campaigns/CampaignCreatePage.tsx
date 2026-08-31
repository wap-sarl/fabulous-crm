import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from 'convex/react';
import { api } from '@crm/lib/backend';
import type { CampaignChannel, CampaignTrackedLink, MessageType } from '@crm/lib/backend';
import { useAuthMutation } from '@crm/widgets';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Input,
  Label,
  PageHeader,
  toast,
} from '@crm/design-system';
import { AlertTriangle, ArrowLeft, Send, Users } from 'lucide-react';
import { usePageTitle } from '../../layouts/DashboardShell';
import { useLeadFilters } from '../../features/leads/hooks/useLeadFilters';
import { toFilterArgs, useMatchingLeads } from '../../features/leads/hooks/useLeadsPaginated';
import { usePropertyDefinitions } from '../../features/properties/hooks/usePropertyDefinitions';
import { LeadsToolbar } from '../../features/leads/components/LeadsToolbar';
import { AdvancedFilterBuilder } from '../../features/filters/components/AdvancedFilterBuilder';
import { applyRecipientFilter } from '../../features/leads/lib/leadFilters';
import { useLeadFieldCatalog } from '../../features/leads/hooks/useLeadFieldCatalog';
import {
  withEmailCompliance,
  withSmsCompliance,
} from '../../features/campaigns/lib/marketingCompliance';
import { CampaignChannelSelector } from '../../features/campaigns/components/CampaignChannelSelector';
import {
  CampaignContentFields,
  type EmailContentMode,
} from '../../features/campaigns/components/CampaignContentFields';
import { buildPlaceholders } from '../../features/campaigns/lib/placeholders';

const numberFormat = new Intl.NumberFormat('fr-FR');

export function CampaignCreatePage() {
  usePageTitle('Nouvelle campagne');
  const navigate = useNavigate();

  const createCampaign = useAuthMutation(api.features.crm.mutations.createCampaign);
  const capabilities = useQuery(api.features.config.queries.getEmailCapabilities);
  const smsAvailable = capabilities?.smsAvailable ?? true;
  const emailConfigured = capabilities?.emailConfigured ?? true;
  const templateAvailable = (capabilities?.emailProvider ?? 'brevo') === 'brevo';
  const { filters, setParam, setAdvancedFilter } = useLeadFilters();
  const propertyDefinitions = usePropertyDefinitions('lead');
  const leadCatalog = useLeadFieldCatalog(propertyDefinitions);
  const matching = useMatchingLeads(filters);

  const [channel, setChannel] = useState<CampaignChannel>('email');
  const [name, setName] = useState('');
  const [emailMode, setEmailMode] = useState<EmailContentMode>('template');
  const [templateId, setTemplateId] = useState('');
  const [subject, setSubject] = useState('');
  const [htmlBody, setHtmlBody] = useState('');
  const [smsBody, setSmsBody] = useState('');
  const [messageType, setMessageType] = useState<MessageType>('marketing');
  const [trackedLinks, setTrackedLinks] = useState<CampaignTrackedLink[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const placeholders = useMemo(
    () => buildPlaceholders(propertyDefinitions, trackedLinks),
    [propertyDefinitions, trackedLinks],
  );

  // Default channel (email) + marketing seed the recipient filter once on mount.
  useEffect(() => {
    setAdvancedFilter(applyRecipientFilter(undefined, 'email', 'marketing'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Under SMTP, Brevo templates are unavailable — fall back to the editor.
  useEffect(() => {
    if (!templateAvailable && emailMode === 'template') setEmailMode('editor');
  }, [templateAvailable, emailMode]);

  // Keep the RGPD opt-out (STOP line / unsubscribe block) in sync with the marketing
  // state: added by default for marketing, removed for transactional. Idempotent, so
  // it never duplicates or clobbers the author's edits. Only the active editable body
  // is touched; the Brevo template mode carries its own footer.
  useEffect(() => {
    if (channel === 'sms') {
      setSmsBody((body) => withSmsCompliance(body, messageType));
    } else if (emailMode === 'editor') {
      setHtmlBody((html) => withEmailCompliance(html, messageType));
    }
  }, [channel, messageType, emailMode]);

  const handleChannelChange = (next: CampaignChannel) => {
    setChannel(next);
    setAdvancedFilter(applyRecipientFilter(filters.advancedFilter, next, messageType));
  };

  const handleMessageTypeChange = (next: MessageType) => {
    setMessageType(next);
    setAdvancedFilter(applyRecipientFilter(filters.advancedFilter, channel, next));
  };

  const total = matching?.total ?? 0;
  const reachable = channel === 'sms' ? (matching?.withPhone ?? 0) : (matching?.withEmail ?? 0);

  // The chosen channel needs its delivery provider configured, otherwise the
  // campaign would silently never send. SMS = Brevo; email = Brevo key or SMTP host.
  const channelReady = channel === 'sms' ? smsAvailable : emailConfigured;

  const handleSubmit = async () => {
    if (!name.trim()) {
      toast.error('Le nom de la campagne est requis.');
      return;
    }
    if (!matching || matching.leadIds.length === 0) {
      toast.error('Aucun lead ne correspond au filtre.');
      return;
    }

    // Assemble the content fields for the chosen channel/mode.
    const content: {
      brevoTemplateId?: number;
      subject?: string;
      htmlBody?: string;
      smsBody?: string;
    } = {};

    if (channel === 'sms') {
      if (!smsBody.trim()) {
        toast.error('Le message SMS est requis.');
        return;
      }
      content.smsBody = smsBody;
    } else if (emailMode === 'editor' || emailMode === 'import') {
      if (!subject.trim()) {
        toast.error('L’objet de l’e-mail est requis.');
        return;
      }
      // TipTap renders an empty document as "<p></p>"; an imported file may be a
      // full document — either way, treat text/images as content.
      const hasContent = htmlBody.replace(/<[^>]*>/g, '').trim() !== '' || /<img/i.test(htmlBody);
      if (!hasContent) {
        toast.error(
          emailMode === 'import' ? 'Importez un fichier HTML.' : 'Le corps de l’e-mail est requis.',
        );
        return;
      }
      content.subject = subject;
      content.htmlBody = htmlBody;
    } else {
      const brevoTemplateId = Number(templateId);
      if (!Number.isInteger(brevoTemplateId) || brevoTemplateId <= 0) {
        toast.error('ID de template Brevo invalide.');
        return;
      }
      content.brevoTemplateId = brevoTemplateId;
    }

    setSubmitting(true);
    try {
      const campaignId = await createCampaign({
        name,
        channel,
        messageType,
        // Recipients are resolved server-side from the filter (no id array —
        // it would cap the campaign at Convex's 8,192-element array limit).
        filter: toFilterArgs(filters),
        trackedLinks: trackedLinks.length > 0 ? trackedLinks : undefined,
        ...content,
      });
      toast.success('Campagne créée, préparation des destinataires en cours.');
      navigate(`/campaigns/${campaignId}`);
    } catch {
      toast.error('Échec de la création de la campagne.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col">
      <PageHeader
        className="px-5 sm:px-7"
        title="Nouvelle campagne"
        subtitle="Ciblez les destinataires avec les filtres, puis créez la campagne."
        actions={
          <Button variant="ghost" onClick={() => navigate('/campaigns')}>
            <ArrowLeft className="h-4 w-4" />
            Retour
          </Button>
        }
      />

      <div className="flex flex-col gap-6 px-5 pb-6 sm:px-7">
        <div className="flex flex-col gap-3">
          <span className="text-sm font-semibold text-ink">Canal</span>
          <CampaignChannelSelector
            value={channel}
            onChange={handleChannelChange}
            smsAvailable={smsAvailable}
          />
        </div>

        <div className="space-y-1 sm:max-w-sm">
          <Label htmlFor="campaign-name">Nom</Label>
          <Input
            id="campaign-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Relance printemps"
          />
        </div>

        <CampaignContentFields
          channel={channel}
          emailMode={emailMode}
          onEmailModeChange={setEmailMode}
          templateId={templateId}
          onTemplateIdChange={setTemplateId}
          subject={subject}
          onSubjectChange={setSubject}
          htmlBody={htmlBody}
          onHtmlBodyChange={setHtmlBody}
          smsBody={smsBody}
          onSmsBodyChange={setSmsBody}
          messageType={messageType}
          onMessageTypeChange={handleMessageTypeChange}
          placeholders={placeholders}
          trackedLinks={trackedLinks}
          onTrackedLinksChange={setTrackedLinks}
          propertyDefinitions={propertyDefinitions}
          templateAvailable={templateAvailable}
        />

        <div className="flex flex-col gap-3">
          <span className="text-sm font-semibold text-ink">Destinataires</span>
          <div className="flex flex-wrap items-start gap-3">
            <LeadsToolbar filters={filters} setParam={setParam} />
            <AdvancedFilterBuilder
              filter={filters.advancedFilter}
              onChange={setAdvancedFilter}
              catalog={leadCatalog}
            />
          </div>
        </div>

        {!channelReady && (
          <Alert variant="warning">
            <AlertTriangle className="size-4" aria-hidden="true" />
            <AlertTitle>
              {channel === 'sms'
                ? 'Aucun compte Brevo configuré'
                : "Aucun fournisseur d'e-mail configuré"}
            </AlertTitle>
            <AlertDescription>
              {channel === 'sms'
                ? 'Les campagnes SMS nécessitent un compte Brevo. '
                : 'Configurez Brevo ou SMTP pour envoyer des e-mails. '}
              <Link to="/settings/email" className="font-semibold underline">
                Configurez l’envoi dans Paramètres → E-mail
              </Link>{' '}
              avant de créer une campagne.
            </AlertDescription>
          </Alert>
        )}

        <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border bg-card p-4 shadow-card">
          <div className="inline-flex items-center gap-2 text-sm text-faint">
            <Users className="size-4" />
            {matching === undefined ? (
              'Calcul des destinataires…'
            ) : (
              <span>
                <span className="font-semibold text-ink">{numberFormat.format(total)} lead(s)</span>{' '}
                correspondent ({numberFormat.format(reachable)}{' '}
                {channel === 'sms' ? 'avec téléphone' : 'avec e-mail'}).{' '}
                {channel === 'sms'
                  ? 'L’envoi se fait par SMS : les leads sans téléphone seront ignorés.'
                  : 'L’envoi se fait par e-mail : les leads sans e-mail seront ignorés.'}
              </span>
            )}
          </div>
          <Button
            onClick={handleSubmit}
            loading={submitting}
            disabled={total === 0 || !channelReady}
            data-testid="create-campaign"
          >
            <Send className="h-4 w-4" />
            Créer la campagne ({numberFormat.format(total)})
          </Button>
        </div>
      </div>
    </div>
  );
}
