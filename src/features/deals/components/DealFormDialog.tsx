import { useMemo, useState } from 'react';
import { useAuthQuery } from '@crm/widgets';
import { api } from '@crm/lib/backend';
import type { DealRow, Doc, Id, PropertyValue } from '@crm/lib/backend';
import { DEFAULT_CURRENCY, defaultPipelineStage, stageRequiresTag } from '@crm/lib/backend';
import {
  Button,
  DatePicker,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  HelperText,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  toast,
  MultiSelect,
} from '@crm/design-system';
import { useEmployees } from '../../../lib/hooks/useEmployees';
import { CURRENCIES } from '../../../lib/constants';
import { CustomPropertyFields } from '../../properties/components/CustomPropertyFields';
import { usePropertyDefinitions } from '../../properties/hooks/usePropertyDefinitions';
import { useDealActions } from '../hooks/useDealActions';
import { usePipelines } from '../hooks/usePipelines';
import { DEAL_ERROR_MESSAGES, dealErrorMessage } from '../lib/errors';
import { LeadPicker } from './LeadPicker';

interface DealFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  deal?: DealRow;
  defaults?: {
    leadId?: Id<'leads'>;
    leadName?: string;
    pipelineId?: Id<'pipelines'>;
  };
  onCreated?: (dealId: Id<'deals'>) => void;
}

interface FormState {
  title: string;
  amount: string;
  currency: string;
  pipelineId: string;
  stageKey: string;
  stageTags: string[];
  stageComment: string;
  expectedCloseDate: string;
  ownerIds: string[];
  leadId: Id<'leads'> | '';
  sourceCampaignId: string;
  customProperties: Record<string, PropertyValue>;
}

const NONE = '__none__';

function initialForm(
  deal: DealRow | undefined,
  defaults: DealFormDialogProps['defaults'],
  pipeline: Doc<'pipelines'> | null | undefined,
): FormState {
  if (deal) {
    return {
      title: deal.title,
      amount: deal.amount !== undefined ? String(deal.amount) : '',
      currency: deal.currency,
      pipelineId: deal.pipelineId,
      stageKey: deal.stageKey,
      stageTags: [],
      stageComment: '',
      expectedCloseDate: deal.expectedCloseDate ?? '',
      ownerIds: deal.ownerIds,
      leadId: deal.leadId ?? '',
      sourceCampaignId: deal.sourceCampaignId ?? '',
      customProperties: { ...(deal.customProperties ?? {}) },
    };
  }
  return {
    title: '',
    amount: '',
    currency: DEFAULT_CURRENCY,
    pipelineId: pipeline?._id ?? '',
    stageKey: pipeline ? (defaultPipelineStage(pipeline)?.key ?? '') : '',
    stageTags: [],
    stageComment: '',
    expectedCloseDate: '',
    ownerIds: [],
    leadId: defaults?.leadId ?? '',
    sourceCampaignId: '',
    customProperties: {},
  };
}

export function DealFormDialog({
  open,
  onOpenChange,
  deal,
  defaults,
  onCreated,
}: DealFormDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        {open ? (
          <DealFormBody
            key={deal?._id ?? 'new'}
            deal={deal}
            defaults={defaults}
            onOpenChange={onOpenChange}
            onCreated={onCreated}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function DealFormBody({
  deal,
  defaults,
  onOpenChange,
  onCreated,
}: Omit<DealFormDialogProps, 'open'>) {
  const isEdit = !!deal;
  const { createDeal, updateDeal } = useDealActions();
  const { pipelines, defaultPipeline, byId } = usePipelines();
  const { employees } = useEmployees();
  const definitions = usePropertyDefinitions('deal');
  const campaigns = useAuthQuery(api.features.crm.queries.listCampaigns, {}) ?? [];
  const [form, setForm] = useState<FormState>(() =>
    initialForm(
      deal,
      defaults,
      (defaults?.pipelineId && byId.get(defaults.pipelineId)) || defaultPipeline,
    ),
  );
  const [submitting, setSubmitting] = useState(false);

  const pipeline =
    byId.get(form.pipelineId) ?? (isEdit ? undefined : (defaultPipeline ?? undefined));
  const stageItems = useMemo(
    () => (pipeline?.stages ?? []).map((s) => ({ value: s.key, label: s.label })),
    [pipeline],
  );
  const formStage = pipeline?.stages.find((s) => s.key === form.stageKey);
  const stageTags = formStage?.tags ?? [];
  const stageTagRequired = formStage ? stageRequiresTag(formStage) : false;

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const handleSubmit = async () => {
    if (!form.title.trim()) {
      toast.error('L’intitulé est requis.');
      return;
    }
    const amount = form.amount.trim() === '' ? undefined : Number(form.amount);
    if (amount !== undefined && (!Number.isFinite(amount) || amount < 0)) {
      toast.error('Montant invalide.');
      return;
    }
    if (!isEdit && stageTagRequired && form.stageTags.length === 0) {
      toast.error(DEAL_ERROR_MESSAGES.stage_tag_required);
      return;
    }
    setSubmitting(true);
    try {
      if (isEdit && deal) {
        await updateDeal({
          dealId: deal._id,
          title: form.title,
          amount: amount ?? null,
          currency: form.currency,
          expectedCloseDate: form.expectedCloseDate || null,
          ownerIds: form.ownerIds as Id<'users'>[],
          leadId: form.leadId || null,
          sourceCampaignId: form.sourceCampaignId
            ? (form.sourceCampaignId as Id<'campaigns'>)
            : null,
          customProperties: form.customProperties,
        });
        toast.success('Transaction mise à jour.');
      } else {
        const pipelineId = (form.pipelineId || pipeline?._id) as Id<'pipelines'> | undefined;
        if (!pipelineId) {
          toast.error('Choisissez un pipeline.');
          return;
        }
        const id = await createDeal({
          title: form.title,
          amount,
          currency: form.currency,
          pipelineId,
          stageKey: form.stageKey || undefined,
          stageTags: stageTags.length ? form.stageTags : undefined,
          stageComment: stageTags.length ? form.stageComment || undefined : undefined,
          expectedCloseDate: form.expectedCloseDate || undefined,
          ownerIds: form.ownerIds as Id<'users'>[],
          leadId: form.leadId || undefined,
          sourceCampaignId: form.sourceCampaignId
            ? (form.sourceCampaignId as Id<'campaigns'>)
            : undefined,
          customProperties: form.customProperties,
        });
        toast.success('Transaction créée.');
        onCreated?.(id);
      }
      onOpenChange(false);
    } catch (e) {
      toast.error(dealErrorMessage(e, 'Une erreur est survenue.'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>{isEdit ? 'Modifier la transaction' : 'Nouvelle transaction'}</DialogTitle>
      </DialogHeader>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor="deal-title">Intitulé *</Label>
          <Input
            id="deal-title"
            value={form.title}
            onChange={(e) => set('title', e.target.value)}
            data-testid="deal-title"
          />
        </div>

        <div className="space-y-1">
          <Label htmlFor="deal-amount">Montant</Label>
          <div className="flex gap-2">
            <Input
              id="deal-amount"
              type="number"
              min={0}
              value={form.amount}
              onChange={(e) => set('amount', e.target.value)}
              className="flex-1"
            />
            <Select value={form.currency} onValueChange={(v) => set('currency', v)}>
              <SelectTrigger className="w-24">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[...new Set([...CURRENCIES, form.currency])].map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="space-y-1">
          <Label htmlFor="deal-close">Clôture prévue</Label>
          <DatePicker
            value={form.expectedCloseDate}
            onValueChange={(v) => set('expectedCloseDate', v)}
          />
        </div>

        {!isEdit ? (
          <>
            <div className="space-y-1">
              <Label>Pipeline</Label>
              <Select
                value={pipeline?._id ?? undefined}
                onValueChange={(v) => {
                  const next = byId.get(v);
                  set('pipelineId', v);
                  set('stageKey', next ? (defaultPipelineStage(next)?.key ?? '') : '');
                }}
              >
                <SelectTrigger data-testid="deal-pipeline">
                  <SelectValue placeholder="Choisir…" />
                </SelectTrigger>
                <SelectContent>
                  {pipelines.map((p) => (
                    <SelectItem key={p._id} value={p._id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Stade</Label>
              <Select
                value={form.stageKey || undefined}
                onValueChange={(v) => setForm((prev) => ({ ...prev, stageKey: v, stageTags: [] }))}
              >
                <SelectTrigger data-testid="deal-stage">
                  <SelectValue placeholder="Choisir…" />
                </SelectTrigger>
                <SelectContent>
                  {stageItems.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {stageTags.length > 0 ? (
              <>
                <div className="space-y-1">
                  <Label>Étiquettes du stade{stageTagRequired ? ' *' : ''}</Label>
                  <MultiSelect
                    items={stageTags.map((t) => ({ value: t.key, label: t.label }))}
                    value={form.stageTags}
                    onValueChange={(v) => set('stageTags', v)}
                    placeholder="Aucune étiquette"
                    modal
                    className="w-full"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="deal-stage-comment">Commentaire du stade</Label>
                  <Input
                    id="deal-stage-comment"
                    value={form.stageComment}
                    onChange={(e) => set('stageComment', e.target.value)}
                  />
                </div>
              </>
            ) : null}
          </>
        ) : null}

        <div className="space-y-1">
          <Label>Propriétaires</Label>
          <MultiSelect
            items={employees.map((e) => ({ value: e._id, label: `${e.firstName} ${e.lastName}` }))}
            value={form.ownerIds}
            onValueChange={(v) => set('ownerIds', v)}
            placeholder="Moi (par défaut)"
            modal
            className="w-full"
          />
        </div>

        <div className="space-y-1 sm:col-span-2">
          <Label>Lead</Label>
          <LeadPicker
            value={form.leadId}
            selectedName={deal?.leadName ?? defaults?.leadName ?? null}
            onChange={(leadId) => set('leadId', leadId)}
            modal
          />
          <HelperText>La transaction apparaît sur la fiche du lead.</HelperText>
        </div>

        <div className="space-y-1 sm:col-span-2">
          <Label>Campagne d’origine</Label>
          <Select
            value={form.sourceCampaignId || NONE}
            onValueChange={(v) => set('sourceCampaignId', v === NONE ? '' : v)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>Aucune</SelectItem>
              {campaigns.map((c) => (
                <SelectItem key={c._id} value={c._id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <HelperText>
            Rattache la transaction à la campagne qui l’a générée (attribution).
          </HelperText>
        </div>
      </div>

      <CustomPropertyFields
        definitions={definitions}
        values={form.customProperties}
        onChange={(id, value) =>
          setForm((prev) => {
            const next = { ...prev.customProperties };
            if (value === undefined) delete next[id];
            else next[id] = value;
            return { ...prev, customProperties: next };
          })
        }
      />

      <DialogFooter>
        <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>
          Annuler
        </Button>
        <Button onClick={handleSubmit} loading={submitting} data-testid="submit-deal">
          {isEdit ? 'Enregistrer' : 'Créer'}
        </Button>
      </DialogFooter>
    </>
  );
}
