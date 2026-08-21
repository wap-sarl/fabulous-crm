import { useRef, useState } from 'react';
import { Input, Label, Textarea, cn } from '@crm/design-system';
import type { CampaignChannel, CampaignTrackedLink, MessageType } from '@crm/lib/backend';
import { MousePointerClick, X } from 'lucide-react';
import type { LeadPropertyDefinitionRow } from '../../leads/types';
import { insertAtCaret, type PlaceholderItem } from '../lib/placeholders';
import { CampaignMessagePreview } from './CampaignMessagePreview';
import { EmailBodyEditor, type EmailBodyEditorHandle } from './EmailBodyEditor';
import { HtmlImportDropzone } from './HtmlImportDropzone';
import { PlaceholderChips } from './PlaceholderChips';
import { TrackedLinkModal } from './TrackedLinkModal';

export type EmailContentMode = 'template' | 'editor' | 'import';

interface Props {
  channel: CampaignChannel;
  emailMode: EmailContentMode;
  onEmailModeChange: (mode: EmailContentMode) => void;
  templateId: string;
  onTemplateIdChange: (value: string) => void;
  subject: string;
  onSubjectChange: (value: string) => void;
  htmlBody: string;
  onHtmlBodyChange: (value: string) => void;
  smsBody: string;
  onSmsBodyChange: (value: string) => void;
  messageType: MessageType;
  onMessageTypeChange: (value: MessageType) => void;
  /** Insertable {{ params.x }} placeholders (fixed + custom props + tracked links). */
  placeholders: PlaceholderItem[];
  trackedLinks: CampaignTrackedLink[];
  onTrackedLinksChange: (links: CampaignTrackedLink[]) => void;
  /** Active custom property definitions (targets of tracked links). */
  propertyDefinitions: LeadPropertyDefinitionRow[];
  /** Brevo templates require the Brevo email provider; false under SMTP. */
  templateAvailable?: boolean;
}

const MESSAGE_TYPES: { value: MessageType; label: string }[] = [
  { value: 'marketing', label: 'Marketing' },
  { value: 'transactional', label: 'Transactionnel' },
];

const EMAIL_MODES: { value: EmailContentMode; label: string }[] = [
  { value: 'template', label: 'Template Brevo' },
  { value: 'editor', label: 'Éditeur' },
  { value: 'import', label: 'Importer HTML' },
];

/** A small segmented (pill) toggle shared by the message-type and email-mode pickers. */
function SegmentedToggle<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="inline-flex rounded-lg border border-border bg-muted/40 p-0.5">
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            aria-pressed={selected}
            className={cn(
              'rounded-md px-3 py-1.5 text-sm font-medium transition',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-soft',
              selected ? 'bg-card text-ink shadow-sm' : 'text-faint hover:text-ink',
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/** Opens the tracked-link modal; shown next to the placeholder chips. */
function AddTrackedLinkButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1 rounded-full border border-dashed border-primary/50 px-2 py-0.5 text-xs font-medium text-primary transition',
        'hover:bg-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-soft',
      )}
    >
      <MousePointerClick className="size-3" aria-hidden="true" />
      Ajouter un lien de suivi
    </button>
  );
}

/**
 * Channel-aware campaign content inputs. A shared marketing/transactional toggle
 * (drives consent gating) sits on top; then, for email, a toggle between a Brevo
 * template id and an in-app WYSIWYG editor; for SMS, a message text area. Every
 * editable field offers click-to-insert placeholder chips, and tracked links
 * (unique per-recipient URLs) can be created via a modal.
 */
export function CampaignContentFields({
  channel,
  emailMode,
  onEmailModeChange,
  templateId,
  onTemplateIdChange,
  subject,
  onSubjectChange,
  htmlBody,
  onHtmlBodyChange,
  smsBody,
  onSmsBodyChange,
  messageType,
  onMessageTypeChange,
  placeholders,
  trackedLinks,
  onTrackedLinksChange,
  propertyDefinitions,
  templateAvailable = true,
}: Props) {
  const smsRef = useRef<HTMLTextAreaElement>(null);
  const subjectRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<EmailBodyEditorHandle>(null);
  const [linkModalOpen, setLinkModalOpen] = useState(false);
  const [importFileName, setImportFileName] = useState<string | null>(null);

  const handleCreateLink = (link: CampaignTrackedLink) => {
    onTrackedLinksChange([...trackedLinks, link]);
    const token = `{{ params.${link.key} }}`;
    if (channel === 'sms') {
      insertAtCaret(smsRef.current, smsBody, token, onSmsBodyChange);
    } else if (emailMode === 'editor') {
      // Insert as a clickable anchor: the label is the visible text, the href
      // is substituted per recipient at send time.
      editorRef.current?.insertLink(token, link.label);
    }
    // Template mode: nothing to insert — the Brevo template references the key.
  };

  const handleRemoveLink = (link: CampaignTrackedLink) => {
    const body =
      channel === 'sms'
        ? smsBody
        : emailMode === 'editor' || emailMode === 'import'
          ? htmlBody
          : '';
    if (
      body.includes(`params.${link.key}`) &&
      !window.confirm(
        `Le message contient encore « {{ params.${link.key} }} » ; ce champ ne sera plus remplacé. Supprimer le lien « ${link.label} » ?`,
      )
    ) {
      return;
    }
    onTrackedLinksChange(trackedLinks.filter((l) => l.key !== link.key));
  };

  const trackedLinkChips = trackedLinks.length > 0 && (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-xs text-muted-foreground">Liens de suivi :</span>
      {trackedLinks.map((link) => (
        <span
          key={link.key}
          className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary-soft/40 px-2 py-0.5 text-xs font-medium text-primary"
        >
          <MousePointerClick className="size-3" aria-hidden="true" />
          {link.label}
          <span className="text-primary/70">({`{{ params.${link.key} }}`})</span>
          <button
            type="button"
            aria-label={`Supprimer le lien ${link.label}`}
            onClick={() => handleRemoveLink(link)}
            className="rounded-full p-0.5 transition hover:bg-primary/10"
          >
            <X className="size-3" aria-hidden="true" />
          </button>
        </span>
      ))}
    </div>
  );

  const linkModal = (
    <TrackedLinkModal
      open={linkModalOpen}
      onOpenChange={setLinkModalOpen}
      definitions={propertyDefinitions}
      existingLinks={trackedLinks}
      onCreate={handleCreateLink}
    />
  );

  const messageTypeField = (
    <div className="space-y-1.5">
      <span className="mr-2 text-sm font-medium text-ink">Type de message</span>
      <SegmentedToggle options={MESSAGE_TYPES} value={messageType} onChange={onMessageTypeChange} />
      <p className="text-xs text-muted-foreground">
        « Marketing » ne cible que les leads ayant consenti à ce canal (filtre ajouté
        automatiquement, modifiable)
        {channel === 'sms' ? ' et applique les règles d’opt-out Brevo' : ''} et ajoute par défaut{' '}
        {channel === 'sms' ? 'une ligne STOP' : 'un bloc de désinscription'} avec le lien de
        consentement (modifiable) ; « Transactionnel » n’applique pas de filtre de consentement.
      </p>
    </div>
  );

  if (channel === 'sms') {
    return (
      <div className="space-y-3">
        {messageTypeField}
        <div className="space-y-1.5">
          <Label htmlFor="sms-body">Message SMS</Label>
          <Textarea
            id="sms-body"
            ref={smsRef}
            value={smsBody}
            onChange={(e) => onSmsBodyChange(e.target.value)}
            placeholder="Bonjour {{ params.firstName }}, …"
            rows={4}
          />
          <PlaceholderChips
            placeholders={placeholders}
            onInsert={(item) => insertAtCaret(smsRef.current, smsBody, item.token, onSmsBodyChange)}
          />
          <AddTrackedLinkButton onClick={() => setLinkModalOpen(true)} />
          {trackedLinkChips}
        </div>
        {linkModal}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {messageTypeField}
      <div className="space-y-1.5">
        <span className="mr-2 text-sm font-medium text-ink">Contenu de l’e-mail</span>
        <SegmentedToggle
          options={
            templateAvailable ? EMAIL_MODES : EMAIL_MODES.filter((m) => m.value !== 'template')
          }
          value={emailMode}
          onChange={onEmailModeChange}
        />
        {!templateAvailable && (
          <p className="text-xs text-warning">
            Les modèles Brevo ne sont pas disponibles en mode SMTP. Utilisez l’éditeur.
          </p>
        )}
      </div>

      {emailMode === 'template' ? (
        <div className="space-y-1.5">
          <Label htmlFor="template-id">ID du template Brevo</Label>
          <Input
            id="template-id"
            type="number"
            value={templateId}
            onChange={(e) => onTemplateIdChange(e.target.value)}
            placeholder="ex. 12"
          />
          <p className="text-xs text-muted-foreground">
            Champs disponibles dans le template : {placeholders.map((p) => p.token).join(', ')}.
          </p>
          <AddTrackedLinkButton onClick={() => setLinkModalOpen(true)} />
          {trackedLinkChips}
        </div>
      ) : emailMode === 'import' ? (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="email-subject">Objet</Label>
            <Input
              id="email-subject"
              ref={subjectRef}
              value={subject}
              onChange={(e) => onSubjectChange(e.target.value)}
              placeholder="Votre formation DPC vous attend"
            />
            {/* No tracked-link chips here: a raw URL in a subject line is useless. */}
            <PlaceholderChips
              placeholders={placeholders.filter((p) => p.kind !== 'link')}
              onInsert={(item) =>
                insertAtCaret(subjectRef.current, subject, item.token, onSubjectChange)
              }
            />
          </div>
          <div className="space-y-1.5">
            <Label>Modèle HTML</Label>
            <HtmlImportDropzone
              onLoad={onHtmlBodyChange}
              fileName={importFileName}
              onFileNameChange={setImportFileName}
            />
            <p className="text-xs text-muted-foreground">
              Le fichier est envoyé tel quel. Insérez les champs dans votre HTML :{' '}
              {placeholders.map((p) => p.token).join(', ')}.
            </p>
            {messageType === 'marketing' && (
              <p className="text-xs text-warning">
                Campagne marketing : votre modèle doit contenir un lien de désinscription pointant
                vers <span className="font-mono">{'{{ params.consentUrl }}'}</span>.
              </p>
            )}
            <AddTrackedLinkButton onClick={() => setLinkModalOpen(true)} />
            {trackedLinkChips}
          </div>
          {htmlBody && (
            <div className="space-y-1.5">
              <Label>Aperçu</Label>
              <CampaignMessagePreview channel="email" subject={subject} html={htmlBody} />
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="email-subject">Objet</Label>
            <Input
              id="email-subject"
              ref={subjectRef}
              value={subject}
              onChange={(e) => onSubjectChange(e.target.value)}
              placeholder="Votre formation DPC vous attend"
            />
            {/* No tracked-link chips here: a raw URL in a subject line is useless. */}
            <PlaceholderChips
              placeholders={placeholders.filter((p) => p.kind !== 'link')}
              onInsert={(item) =>
                insertAtCaret(subjectRef.current, subject, item.token, onSubjectChange)
              }
            />
          </div>
          <div className="space-y-1.5">
            <Label>Corps de l’e-mail</Label>
            <EmailBodyEditor
              ref={editorRef}
              value={htmlBody}
              onChange={onHtmlBodyChange}
              placeholders={placeholders}
              onRequestTrackedLink={() => setLinkModalOpen(true)}
            />
            {trackedLinkChips}
          </div>
        </div>
      )}
      {linkModal}
    </div>
  );
}
