import { useMemo, useRef } from 'react';
import { Input, Label, Textarea } from '@crm/design-system';
import type { WorkflowNode } from '@crm/lib/backend';
import { EmailBodyEditor, type EmailBodyEditorHandle } from '../../../campaigns/components/EmailBodyEditor';
import { PlaceholderChips } from '../../../campaigns/components/PlaceholderChips';
import { buildPlaceholders, insertAtCaret } from '../../../campaigns/lib/placeholders';
import type { LeadPropertyDefinitionRow } from '../../../leads/types';

type EmailNode = Extract<WorkflowNode, { type: 'send_email' }>;
type SmsNode = Extract<WorkflowNode, { type: 'send_sms' }>;

interface EmailStepConfigProps {
  value: EmailNode;
  onChange: (next: EmailNode) => void;
  definitions: LeadPropertyDefinitionRow[];
}

/** Subject + TipTap body with {{ params.x }} placeholder chips (no tracked links). */
export function EmailStepConfig({ value, onChange, definitions }: EmailStepConfigProps) {
  const subjectRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<EmailBodyEditorHandle>(null);
  const placeholders = useMemo(() => buildPlaceholders(definitions, []), [definitions]);

  return (
    <div className="flex flex-col gap-4">
      <div className="space-y-1.5">
        <Label htmlFor="wf-email-subject">Objet</Label>
        <Input
          id="wf-email-subject"
          ref={subjectRef}
          value={value.subject}
          onChange={(e) => onChange({ ...value, subject: e.target.value })}
          placeholder="Bienvenue {{ params.firstName }} !"
        />
        <PlaceholderChips
          placeholders={placeholders}
          onInsert={(item) =>
            insertAtCaret(subjectRef.current, value.subject, item.token, (subject) =>
              onChange({ ...value, subject })
            )
          }
        />
      </div>
      <div className="space-y-1.5">
        <Label>Corps de l’e-mail</Label>
        <EmailBodyEditor
          ref={editorRef}
          value={value.htmlBody}
          onChange={(htmlBody) => onChange({ ...value, htmlBody })}
          placeholders={placeholders}
        />
      </div>
    </div>
  );
}

interface SmsStepConfigProps {
  value: SmsNode;
  onChange: (next: SmsNode) => void;
  definitions: LeadPropertyDefinitionRow[];
}

export function SmsStepConfig({ value, onChange, definitions }: SmsStepConfigProps) {
  const smsRef = useRef<HTMLTextAreaElement>(null);
  const placeholders = useMemo(() => buildPlaceholders(definitions, []), [definitions]);

  return (
    <div className="space-y-1.5">
      <Label htmlFor="wf-sms-body">Message SMS</Label>
      <Textarea
        id="wf-sms-body"
        ref={smsRef}
        rows={5}
        value={value.smsBody}
        onChange={(e) => onChange({ ...value, smsBody: e.target.value })}
        placeholder="Bonjour {{ params.firstName }}, …"
      />
      <PlaceholderChips
        placeholders={placeholders}
        onInsert={(item) =>
          insertAtCaret(smsRef.current, value.smsBody, item.token, (smsBody) =>
            onChange({ ...value, smsBody })
          )
        }
      />
    </div>
  );
}
