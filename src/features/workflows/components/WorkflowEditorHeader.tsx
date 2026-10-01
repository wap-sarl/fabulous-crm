import type { Dispatch } from 'react';
import type { NavigateFunction } from 'react-router-dom';
import type { WorkflowStatus } from '@crm/lib/backend';
import { Button, Input, StatusBadge } from '@crm/design-system';
import { ArrowLeft, Pause, Play, Save } from 'lucide-react';
import type { DraftAction } from '../hooks/useWorkflowDraft';
import { WORKFLOW_STATUS_LABEL, WORKFLOW_STATUS_TONE } from '../lib/constants';
import type { WorkflowDraft } from '../types';

interface WorkflowEditorHeaderProps {
  isEdit: boolean;
  workflowId: string | undefined;
  navigate: NavigateFunction;
  draft: WorkflowDraft;
  dispatch: Dispatch<DraftAction>;
  status: WorkflowStatus;
  readOnly: boolean;
  submitting: boolean;
  setSaveChoiceOpen: (open: boolean) => void;
  handleSave: () => Promise<void>;
  handleActivate: () => Promise<void>;
  handlePause: () => Promise<void>;
}

export function WorkflowEditorHeader({
  isEdit,
  workflowId,
  navigate,
  draft,
  dispatch,
  status,
  readOnly,
  submitting,
  setSaveChoiceOpen,
  handleSave,
  handleActivate,
  handlePause,
}: WorkflowEditorHeaderProps) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button
        variant="ghost"
        size="sm"
        onClick={() => navigate(isEdit ? `/workflows/${workflowId}` : '/workflows')}
      >
        <ArrowLeft className="size-4" />
        Retour
      </Button>
      <Input
        value={draft.name}
        onChange={(e) => dispatch({ type: 'setName', name: e.target.value })}
        placeholder="Nom du workflow"
        className="w-72 font-semibold"
        data-testid="workflow-name"
        disabled={readOnly}
      />
      <StatusBadge tone={WORKFLOW_STATUS_TONE[status]}>{WORKFLOW_STATUS_LABEL[status]}</StatusBadge>
      <div className="ml-auto flex items-center gap-2">
        {readOnly ? (
          <Button variant="outline" onClick={handlePause} disabled={submitting}>
            <Pause className="size-4" />
            Mettre en pause pour modifier
          </Button>
        ) : (
          <>
            <Button
              variant="outline"
              onClick={() => (isEdit ? setSaveChoiceOpen(true) : void handleSave())}
              disabled={submitting}
              data-testid="save-workflow"
            >
              <Save className="size-4" />
              Enregistrer
            </Button>
            <Button onClick={handleActivate} disabled={submitting} data-testid="activate-workflow">
              <Play className="size-4" />
              Activer
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
