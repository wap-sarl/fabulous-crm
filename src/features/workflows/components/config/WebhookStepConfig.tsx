import { HelperText, Input, Label } from '@crm/design-system';
import type { WorkflowNode } from '@crm/lib/backend';

type WebhookNode = Extract<WorkflowNode, { type: 'webhook' }>;

interface WebhookStepConfigProps {
  value: WebhookNode;
  onChange: (next: WebhookNode) => void;
}

export function WebhookStepConfig({ value, onChange }: WebhookStepConfigProps) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor="wf-webhook-url">URL du webhook</Label>
      <Input
        id="wf-webhook-url"
        type="url"
        value={value.url}
        onChange={(e) => onChange({ ...value, url: e.target.value })}
        placeholder="https://exemple.fr/hooks/crm"
      />
      <HelperText>
        Une requête POST (JSON) est envoyée avec les données du lead et du workflow.
      </HelperText>
    </div>
  );
}
