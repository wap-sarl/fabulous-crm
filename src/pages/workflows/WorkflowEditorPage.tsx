import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '@crm/lib/backend';
import type { Id, WorkflowNode } from '@crm/lib/backend';
import { useAuthMutation, useAuthQuery } from '@crm/widgets';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Spinner,
  StatusBadge,
  toast,
} from '@crm/design-system';
import { ArrowLeft, Pause, Play, RefreshCw, Save } from 'lucide-react';
import { usePageTitle } from '../../layouts/DashboardShell';
import { useLeadPropertyDefinitions } from '../../features/leads/hooks/useLeadPropertyDefinitions';
import { useLeadLists } from '../../features/leads/hooks/useLeadLists';
import { useLifecycleConfig } from '../../features/leads/hooks/useLifecycleConfig';
import { useWorkflowDraft, subtreeIds } from '../../features/workflows/hooks/useWorkflowDraft';
import { draftFromWorkflow, draftToPayload, type InsertSlot } from '../../features/workflows/types';
import { WorkflowCanvas } from '../../features/workflows/components/WorkflowCanvas';
import { StepTypePicker } from '../../features/workflows/components/StepTypePicker';
import {
  StepConfigPanel,
  type PanelSelection,
} from '../../features/workflows/components/StepConfigPanel';
import type { TriggerFormValue } from '../../features/workflows/components/config/TriggerConfig';
import {
  WORKFLOW_STATUS_LABEL,
  WORKFLOW_STATUS_TONE,
} from '../../features/workflows/lib/constants';
import { invalidNodeIds, validateWorkflowDraft } from '../../features/workflows/lib/validation';

export function WorkflowEditorPage() {
  const { workflowId } = useParams<{ workflowId: string }>();
  const isEdit = workflowId !== undefined;
  usePageTitle(isEdit ? 'Modifier le workflow' : 'Nouveau workflow');
  const navigate = useNavigate();

  const definitions = useLeadPropertyDefinitions();
  const lists = useLeadLists();
  const existing = useAuthQuery(
    api.features.workflows.queries.getWorkflow,
    isEdit ? { workflowId: workflowId as Id<'workflows'> } : 'skip',
  );

  const createWorkflow = useAuthMutation(api.features.workflows.mutations.createWorkflow);
  const updateWorkflow = useAuthMutation(api.features.workflows.mutations.updateWorkflow);
  const setWorkflowStatus = useAuthMutation(api.features.workflows.mutations.setWorkflowStatus);
  const reenrollMatchingLeads = useAuthMutation(
    api.features.workflows.mutations.reenrollMatchingLeads,
  );

  const [state, dispatch] = useWorkflowDraft();
  const { draft } = state;
  const [selectedId, setSelectedId] = useState<string | 'trigger' | null>(null);
  const [pickerSlot, setPickerSlot] = useState<InsertSlot | null>(null);
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [saveChoiceOpen, setSaveChoiceOpen] = useState(false);

  // Matching-lead count for the save dialog (criteria evaluated live).
  const matching = useAuthQuery(
    api.features.crm.queries.listMatchingLeadIds,
    saveChoiceOpen ? { advancedFilter: draft.enrollmentCriteria } : 'skip',
  );

  // Seed the local draft once the edited workflow loads.
  const [seeded, setSeeded] = useState(false);
  useEffect(() => {
    if (isEdit && existing && !seeded) {
      dispatch({ type: 'init', draft: draftFromWorkflow(existing) });
      setSeeded(true);
    }
  }, [isEdit, existing, seeded, dispatch]);

  // Auto-open the config panel of a freshly inserted step.
  useEffect(() => {
    if (state.lastInsertedId) setSelectedId(state.lastInsertedId);
  }, [state.lastInsertedId]);

  const status = isEdit ? (existing?.status ?? 'draft') : 'draft';
  const readOnly = status === 'active';

  const errors = useMemo(() => validateWorkflowDraft(draft), [draft]);
  const invalidIds = useMemo(
    () => (showErrors ? invalidNodeIds(errors) : undefined),
    [showErrors, errors],
  );

  const listNameById = useMemo(() => new Map(lists.map((l) => [l._id as string, l.name])), [lists]);
  const definitionLabelById = useMemo(
    () => new Map(definitions.map((d) => [d._id as string, d.label])),
    [definitions],
  );
  const lifecycle = useLifecycleConfig();
  const lifecycleStageLabelByKey = useMemo(
    () => new Map(lifecycle.stages.map((s) => [s.key, s.label])),
    [lifecycle.stages],
  );

  const selection: PanelSelection = useMemo(() => {
    if (selectedId === 'trigger') {
      return {
        kind: 'trigger',
        value: {
          trigger: draft.trigger,
          enrollmentCriteria: draft.enrollmentCriteria,
          allowReEnrollment: draft.allowReEnrollment,
        },
      };
    }
    if (selectedId && draft.nodes[selectedId]) {
      return { kind: 'node', node: draft.nodes[selectedId] };
    }
    return null;
  }, [selectedId, draft]);

  const requestRemove = (id: string) => {
    const node = draft.nodes[id];
    if (!node) return;
    const dependents = node.type === 'branch' ? subtreeIds(draft.nodes, id).length - 1 : 0;
    if (dependents > 0) setConfirmRemoveId(id);
    else dispatch({ type: 'removeNode', id });
  };

  /** Persist the draft; returns the workflow id, or null when blocked. */
  const save = async (): Promise<Id<'workflows'> | null> => {
    if (!draft.name.trim()) {
      toast.error('Le nom du workflow est requis.');
      return null;
    }
    if (!draft.trigger) {
      toast.error('Choisissez un événement déclencheur avant d’enregistrer.');
      setSelectedId('trigger');
      return null;
    }
    const payload = draftToPayload(draft, draft.trigger);
    if (isEdit) {
      await updateWorkflow({ workflowId: workflowId as Id<'workflows'>, ...payload });
      return workflowId as Id<'workflows'>;
    }
    return await createWorkflow(payload);
  };

  const handleSave = async () => {
    setSubmitting(true);
    try {
      const id = await save();
      if (!id) return;
      toast.success('Workflow enregistré.');
      setSaveChoiceOpen(false);
      if (!isEdit) navigate(`/workflows/${id}/edit`, { replace: true });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Échec de l’enregistrement.');
    } finally {
      setSubmitting(false);
    }
  };

  /** Save, activate if needed, then bulk re-enroll every matching lead. */
  const handleSaveAndReenroll = async () => {
    setShowErrors(true);
    if (errors.length > 0) {
      setSaveChoiceOpen(false);
      toast.error(errors[0]!.message);
      if (errors[0]!.nodeId) setSelectedId(errors[0]!.nodeId);
      return;
    }
    setSubmitting(true);
    try {
      const id = await save();
      if (!id) return;
      if (status !== 'active') {
        await setWorkflowStatus({ workflowId: id, status: 'active' });
      }
      // The re-enroll runs as a scheduled batch chain server-side; progress is
      // shown live on the workflow detail page we navigate to.
      await reenrollMatchingLeads({ workflowId: id });
      toast.success('Réinscription lancée — suivez la progression sur la page du workflow.');
      navigate(`/workflows/${id}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Échec de la réinscription.');
    } finally {
      setSubmitting(false);
      setSaveChoiceOpen(false);
    }
  };

  const handleActivate = async () => {
    setShowErrors(true);
    if (errors.length > 0) {
      toast.error(errors[0]!.message);
      if (errors[0]!.nodeId) setSelectedId(errors[0]!.nodeId);
      return;
    }
    setSubmitting(true);
    try {
      const id = await save();
      if (!id) return;
      await setWorkflowStatus({ workflowId: id, status: 'active' });
      toast.success('Workflow activé.');
      navigate(`/workflows/${id}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Échec de l’activation.');
    } finally {
      setSubmitting(false);
    }
  };

  const handlePause = async () => {
    setSubmitting(true);
    try {
      await setWorkflowStatus({
        workflowId: workflowId as Id<'workflows'>,
        status: 'paused',
      });
      toast.success('Workflow mis en pause. Vous pouvez le modifier.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Échec de la mise en pause.');
    } finally {
      setSubmitting(false);
    }
  };

  if (isEdit && existing === undefined) {
    return (
      <div className="flex justify-center py-16">
        <Spinner size="lg" />
      </div>
    );
  }
  if (isEdit && existing === null) {
    return <div className="px-7 py-10 text-faint">Workflow introuvable.</div>;
  }

  return (
    <div className="flex h-[calc(100dvh-120px)] min-h-[560px] flex-col gap-3 px-5 py-4 sm:px-7">
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
        <StatusBadge tone={WORKFLOW_STATUS_TONE[status]}>
          {WORKFLOW_STATUS_LABEL[status]}
        </StatusBadge>
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
              <Button
                onClick={handleActivate}
                disabled={submitting}
                data-testid="activate-workflow"
              >
                <Play className="size-4" />
                Activer
              </Button>
            </>
          )}
        </div>
      </div>

      {readOnly ? (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-[13px] text-amber-800">
          Ce workflow est actif : mettez-le en pause pour modifier son déclencheur ou ses étapes.
        </div>
      ) : null}

      <WorkflowCanvas
        draft={draft}
        invalidIds={invalidIds}
        className="min-h-0 flex-1"
        handlers={{
          selectedId,
          onSelect: setSelectedId,
          onInsert: setPickerSlot,
          onRemove: requestRemove,
          listNameById,
          definitionLabelById,
          lifecycleStageLabelByKey,
          readOnly,
        }}
      />

      <StepTypePicker
        open={pickerSlot !== null}
        onOpenChange={(open) => !open && setPickerSlot(null)}
        onPick={(type) => {
          if (!pickerSlot) return;
          dispatch({
            type: 'insertNode',
            slot: pickerSlot,
            nodeType: type,
            id: crypto.randomUUID(),
          });
          setPickerSlot(null);
        }}
      />

      <StepConfigPanel
        selection={selection}
        definitions={definitions}
        readOnly={readOnly}
        onClose={() => setSelectedId(null)}
        onApplyNode={(node: WorkflowNode) => {
          dispatch({ type: 'updateNode', node });
          setSelectedId(null);
        }}
        onApplyTrigger={(value: TriggerFormValue) => {
          dispatch({ type: 'setTrigger', trigger: value.trigger });
          dispatch({ type: 'setEnrollmentCriteria', filter: value.enrollmentCriteria });
          dispatch({ type: 'setAllowReEnrollment', value: value.allowReEnrollment });
          setSelectedId(null);
        }}
      />

      <Dialog open={saveChoiceOpen} onOpenChange={(open) => !submitting && setSaveChoiceOpen(open)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Enregistrer le workflow</DialogTitle>
            <DialogDescription>
              Enregistrer simplement les modifications, ou aussi réinscrire les leads qui
              correspondent aux critères d’inscription ?
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2 text-[13px]">
            <div className="rounded-lg border bg-canvas px-3 py-2 text-body">
              {matching === undefined ? (
                <span className="inline-flex items-center gap-2">
                  <Spinner size="sm" /> Calcul des leads correspondants…
                </span>
              ) : (
                <>
                  <span className="font-bold text-ink">{matching.total}</span> lead(s)
                  correspondant(s){' '}
                  {draft.enrollmentCriteria
                    ? 'aux critères d’inscription.'
                    : '— aucun critère : tous les leads sont concernés.'}
                </>
              )}
            </div>
            <p className="text-faint">
              La réinscription annule les parcours en cours et relance chaque lead sur la nouvelle
              version du workflow (même si la réinscription est désactivée).
            </p>
          </div>
          <DialogFooter className="flex-col gap-2 sm:flex-col">
            <Button
              className="w-full"
              variant="outline"
              disabled={submitting}
              onClick={handleSave}
              data-testid="save-only"
            >
              <Save className="size-4" />
              Enregistrer uniquement
            </Button>
            <Button
              className="w-full"
              disabled={submitting || matching === undefined}
              onClick={handleSaveAndReenroll}
              data-testid="save-and-reenroll"
            >
              <RefreshCw className="size-4" />
              Enregistrer et réinscrire {matching ? `${matching.total} lead(s)` : '…'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={confirmRemoveId !== null}
        onOpenChange={(open) => !open && setConfirmRemoveId(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Supprimer la condition ?</DialogTitle>
            <DialogDescription>
              {confirmRemoveId
                ? `Supprimer cette condition supprimera aussi les ${
                    subtreeIds(draft.nodes, confirmRemoveId).length - 1
                  } étape(s) qui en dépendent.`
                : null}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmRemoveId(null)}>
              Annuler
            </Button>
            <Button
              color="destructive"
              onClick={() => {
                if (confirmRemoveId) dispatch({ type: 'removeNode', id: confirmRemoveId });
                setConfirmRemoveId(null);
              }}
            >
              Supprimer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
