import { useState } from 'react';
import {
  Button,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@crm/design-system';
import type { WorkflowNode } from '@crm/lib/backend';
import type { LeadPropertyDefinitionRow } from '../../leads/types';
import { STEP_TYPE_META } from '../lib/constants';
import { TriggerConfig, type TriggerFormValue } from './config/TriggerConfig';
import { EmailStepConfig, SmsStepConfig } from './config/MessageStepConfigs';
import {
  ListStepConfig,
  PropertyStepConfig,
  WaitStepConfig,
  WebhookStepConfig,
} from './config/SimpleStepConfigs';
import { BranchStepConfig } from './config/BranchStepConfig';

export type PanelSelection =
  | { kind: 'trigger'; value: TriggerFormValue }
  | { kind: 'node'; node: WorkflowNode }
  | null;

interface StepConfigPanelProps {
  selection: PanelSelection;
  definitions: LeadPropertyDefinitionRow[];
  readOnly?: boolean;
  onClose: () => void;
  onApplyNode: (node: WorkflowNode) => void;
  onApplyTrigger: (value: TriggerFormValue) => void;
}

/**
 * Right-hand configuration Sheet for the selected trigger/step. Edits a local
 * copy (remounted per selection via `key`) and commits on « Appliquer » — the
 * canvas draft only changes when the user confirms.
 */
export function StepConfigPanel(props: StepConfigPanelProps) {
  const { selection, onClose } = props;
  return (
    <Sheet open={selection !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="flex w-full flex-col gap-0 overflow-y-auto sm:max-w-xl">
        {selection?.kind === 'trigger' ? (
          <TriggerPanelBody key="trigger" {...props} initial={selection.value} />
        ) : selection?.kind === 'node' ? (
          <NodePanelBody key={selection.node.id} {...props} initial={selection.node} />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function TriggerPanelBody({
  initial,
  definitions,
  readOnly,
  onClose,
  onApplyTrigger,
}: StepConfigPanelProps & { initial: TriggerFormValue }) {
  const [value, setValue] = useState<TriggerFormValue>(initial);
  return (
    <>
      <SheetHeader>
        <SheetTitle>Déclencheur</SheetTitle>
        <SheetDescription>Quand un lead doit-il entrer dans ce workflow ?</SheetDescription>
      </SheetHeader>
      <div className="flex-1 py-4">
        <TriggerConfig value={value} onChange={setValue} definitions={definitions} />
      </div>
      <SheetFooter className="sticky bottom-0 mt-auto flex-row justify-end gap-2 border-t bg-card py-3">
        <Button variant="ghost" onClick={onClose}>
          Annuler
        </Button>
        <Button
          disabled={readOnly}
          data-testid="apply-trigger"
          onClick={() => onApplyTrigger(value)}
        >
          Appliquer
        </Button>
      </SheetFooter>
    </>
  );
}

function NodePanelBody({
  initial,
  definitions,
  readOnly,
  onClose,
  onApplyNode,
}: StepConfigPanelProps & { initial: WorkflowNode }) {
  const [node, setNode] = useState<WorkflowNode>(initial);
  const meta = STEP_TYPE_META.get(node.type);

  return (
    <>
      <SheetHeader>
        <SheetTitle>{meta?.label ?? node.type}</SheetTitle>
        <SheetDescription>Configurez cette étape du workflow.</SheetDescription>
      </SheetHeader>
      <div className="flex-1 py-4">
        {node.type === 'send_email' ? (
          <EmailStepConfig value={node} onChange={setNode} definitions={definitions} />
        ) : node.type === 'send_sms' ? (
          <SmsStepConfig value={node} onChange={setNode} definitions={definitions} />
        ) : node.type === 'update_property' ? (
          <PropertyStepConfig value={node} onChange={setNode} definitions={definitions} />
        ) : node.type === 'add_to_list' || node.type === 'remove_from_list' ? (
          <ListStepConfig value={node} onChange={setNode} />
        ) : node.type === 'wait' ? (
          <WaitStepConfig value={node} onChange={setNode} />
        ) : node.type === 'webhook' ? (
          <WebhookStepConfig value={node} onChange={setNode} />
        ) : (
          <BranchStepConfig value={node} onChange={setNode} definitions={definitions} />
        )}
      </div>
      <SheetFooter className="sticky bottom-0 mt-auto flex-row justify-end gap-2 border-t bg-card py-3">
        <Button variant="ghost" onClick={onClose}>
          Annuler
        </Button>
        <Button disabled={readOnly} data-testid="apply-step" onClick={() => onApplyNode(node)}>
          Appliquer
        </Button>
      </SheetFooter>
    </>
  );
}
