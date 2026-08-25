import { useMemo, useState } from 'react';
import { useAuthQuery } from '@crm/widgets';
import { api } from '@crm/lib/backend';
import type { DealRow, Doc, Id } from '@crm/lib/backend';
import { DEFAULT_CURRENCY, defaultPipelineStage } from '@crm/lib/backend';
import {
  Button,
  Combobox,
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
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  toast,
} from '@crm/design-system';
import { useEmployees } from '../../../lib/hooks/useEmployees';
import { CURRENCIES } from '../../../lib/constants';
import { CompanyPicker } from '../../companies/components/CompanyPicker';
import { useDealActions } from '../hooks/useDealActions';
import { usePipelines } from '../hooks/usePipelines';
import { dealErrorMessage } from '../lib/errors';
import { LeadPicker } from './LeadPicker';

interface DealFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  deal?: DealRow;
  defaults?: {
    leadId?: Id<'leads'>;
    leadName?: string;
    companyId?: Id<'companies'>;
    companyName?: string;
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
  expectedCloseDate: string;
  ownerId: string;
  leadId: Id<'leads'> | '';
  companyId: Id<'companies'> | '';
  sourceCampaignId: string;
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
      expectedCloseDate: deal.expectedCloseDate ?? '',
      ownerId: deal.ownerId ?? '',
      leadId: deal.leadId ?? '',
      companyId: deal.companyId ?? '',
      sourceCampaignId: deal.sourceCampaignId ?? '',
    };
  }
  return {
    title: '',
    amount: '',
    currency: DEFAULT_CURRENCY,
    pipelineId: pipeline?._id ?? '',
    stageKey: pipeline ? (defaultPipelineStage(pipeline)?.key ?? '') : '',
    expectedCloseDate: '',
    ownerId: '',
    leadId: defaults?.leadId ?? '',
    companyId: defaults?.companyId ?? '',
    sourceCampaignId: '',
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
  const campaigns = useAuthQuery(api.features.crm.queries.listCampaigns, {}) ?? [];
  const [form, setForm] = useState<FormState>(() =>
    initialForm(
      deal,
      defaults,
      (defaults?.pipelineId && byId.get(defaults.pipelineId)) || defaultPipeline,
    ),
  );
  const [submitting, setSubmitting] = useState(false);
  const [target, setTarget] = useState<'lead' | 'company'>(() =>
    (deal ? !deal.leadId && !!deal.companyId : !defaults?.leadId && !!defaults?.companyId)
      ? 'company'
      : 'lead',
  );
  const [leadCompanyName, setLeadCompanyName] = useState<string | null>(null);

  const pipeline =
    byId.get(form.pipelineId) ?? (isEdit ? undefined : (defaultPipeline ?? undefined));
  const stageItems = useMemo(
    () => (pipeline?.stages ?? []).map((s) => ({ value: s.key, label: s.label })),
    [pipeline],
  );

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
    setSubmitting(true);
    try {
      if (isEdit && deal) {
        await updateDeal({
          dealId: deal._id,
          title: form.title,
          amount: amount ?? null,
          currency: form.currency,
          expectedCloseDate: form.expectedCloseDate || null,
          ownerId: form.ownerId ? (form.ownerId as Id<'users'>) : null,
          leadId: form.leadId || null,
          companyId: form.companyId || null,
          sourceCampaignId: form.sourceCampaignId
            ? (form.sourceCampaignId as Id<'campaigns'>)
            : null,
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
          expectedCloseDate: form.expectedCloseDate || undefined,
          ownerId: form.ownerId ? (form.ownerId as Id<'users'>) : undefined,
          leadId: form.leadId || undefined,
          companyId: form.companyId || undefined,
          sourceCampaignId: form.sourceCampaignId
            ? (form.sourceCampaignId as Id<'campaigns'>)
            : undefined,
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
              <Select value={form.stageKey || undefined} onValueChange={(v) => set('stageKey', v)}>
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
          </>
        ) : null}

        <div className="space-y-1">
          <Label>Propriétaire</Label>
          <Combobox
            items={[
              { value: '', label: 'Moi (par défaut)' },
              ...employees.map((e) => ({ value: e._id, label: `${e.firstName} ${e.lastName}` })),
            ]}
            value={form.ownerId}
            onValueChange={(v) => set('ownerId', v)}
            placeholder="Moi (par défaut)"
            modal
            className="w-full"
          />
        </div>

        <div className="space-y-2 sm:col-span-2">
          <Label>Rattachée à</Label>
          <Tabs
            value={target}
            onValueChange={(v) => {
              const next = v as 'lead' | 'company';
              setTarget(next);
              if (next === 'company') set('leadId', '');
            }}
          >
            <TabsList>
              <TabsTrigger value="lead" data-testid="deal-target-lead">
                Lead
              </TabsTrigger>
              <TabsTrigger value="company" data-testid="deal-target-company">
                Entreprise
              </TabsTrigger>
            </TabsList>
            <TabsContent value="lead" className="pt-2">
              <LeadPicker
                value={form.leadId}
                selectedName={deal?.leadName ?? defaults?.leadName ?? null}
                onChange={(leadId, companyId, companyName) => {
                  set('leadId', leadId);
                  set('companyId', companyId ?? '');
                  setLeadCompanyName(companyName);
                }}
                modal
              />
              <HelperText>
                {form.leadId
                  ? form.companyId
                    ? `Entreprise du lead : ${leadCompanyName ?? deal?.companyName ?? defaults?.companyName ?? '—'}.`
                    : 'Ce lead n’a pas d’entreprise.'
                  : 'La transaction suit ce lead et son entreprise.'}
              </HelperText>
            </TabsContent>
            <TabsContent value="company" className="pt-2">
              <CompanyPicker
                value={form.companyId}
                selectedName={deal?.companyName ?? defaults?.companyName ?? null}
                onChange={(v) => set('companyId', v)}
                modal
              />
              <HelperText>Transaction au niveau de l’entreprise, sans lead particulier.</HelperText>
            </TabsContent>
          </Tabs>
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
