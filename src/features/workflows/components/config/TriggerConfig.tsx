import { useMemo, useState } from 'react';
import {
  HelperText,
  Label,
  MultiSelect,
  SegmentedControl,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
  Switch,
} from '@crm/design-system';
import { api } from '@crm/lib/backend';
import type {
  FilterField,
  LeadAdvancedFilter,
  LeadStandardField,
  WorkflowTrigger,
} from '@crm/lib/backend';
import { useAuthQuery } from '@crm/widgets';
import { AdvancedFilterGroupsEditor } from '../../../filters/components/AdvancedFilterBuilder';
import { countActiveRules, emptyAdvancedFilter } from '../../../filters/lib/advancedFilter';
import { LEAD_FILTER_FIELDS } from '../../../leads/lib/leadFilters';
import { useLeadFieldCatalog } from '../../../leads/hooks/useLeadFieldCatalog';
import { useLeadLists } from '../../../leads/hooks/useLeadLists';
import { usePipelines } from '../../../deals/hooks/usePipelines';
import type { PropertyDefinitionRow } from '../../../properties/types';
import { optionToTrigger, TRIGGER_GROUPS, triggerToOption } from '../../lib/constants';

export interface TriggerFormValue {
  trigger: WorkflowTrigger | null;
  enrollmentCriteria?: LeadAdvancedFilter;
  allowReEnrollment: boolean;
}

interface TriggerConfigProps {
  value: TriggerFormValue;
  onChange: (next: TriggerFormValue) => void;
  definitions: PropertyDefinitionRow[];
}

const ANY = '__any__';

const encodeField = (f: FilterField<LeadStandardField>) =>
  f.kind === 'standard' ? `std:${f.field}` : `cp:${f.definitionId}`;
const decodeField = (key: string): FilterField<LeadStandardField> =>
  key.startsWith('cp:')
    ? { kind: 'custom', definitionId: key.slice(3) }
    : { kind: 'standard', field: key.slice(4) as LeadStandardField };

/**
 * Trigger panel body: the enrollment event (grouped Select), its per-type
 * refinements, the AND/OR enrollment criteria and the re-enrollment toggle.
 * Fully controlled — the parent panel owns the draft-then-commit cycle.
 */
export function TriggerConfig({ value, onChange, definitions }: TriggerConfigProps) {
  const lists = useLeadLists();
  const leadCatalog = useLeadFieldCatalog(definitions);
  const { pipelines, byId: pipelineById } = usePipelines();
  const campaigns = useAuthQuery(api.features.crm.queries.listCampaigns, {}) ?? [];
  const { trigger } = value;

  // The criteria editor always needs a filter object to edit; whether the
  // stored criteria exist is decided by the active-rule count on apply (parent).
  const [criteriaDraft, setCriteriaDraft] = useState<LeadAdvancedFilter>(
    () => value.enrollmentCriteria ?? emptyAdvancedFilter(LEAD_FILTER_FIELDS),
  );

  const setTrigger = (next: WorkflowTrigger) => onChange({ ...value, trigger: next });

  const campaignItems = useMemo(() => {
    const wanted =
      trigger?.type === 'campaign_email_event'
        ? 'email'
        : trigger?.type === 'campaign_sms_event'
          ? 'sms'
          : null;
    return campaigns
      .filter((c) => wanted === null || (c.channel ?? 'email') === wanted)
      .map((c) => ({ value: c._id as string, label: c.name }));
  }, [campaigns, trigger?.type]);

  const fieldItems = useMemo(
    () => [
      ...LEAD_FILTER_FIELDS.map((f) => ({ value: `std:${f.field}`, label: f.label })),
      ...definitions.map((d) => ({ value: `cp:${d._id}`, label: d.label })),
    ],
    [definitions],
  );

  return (
    <div className="flex flex-col gap-5">
      <div className="space-y-1.5">
        <Label>Événement déclencheur</Label>
        <Select
          value={trigger ? triggerToOption(trigger) : undefined}
          onValueChange={(v) => setTrigger(optionToTrigger(v as never, trigger))}
        >
          <SelectTrigger className="w-full" data-testid="trigger-event-select">
            <SelectValue placeholder="Choisir un événement…" />
          </SelectTrigger>
          <SelectContent>
            {TRIGGER_GROUPS.map((group) => (
              <SelectGroup key={group.label}>
                <SelectLabel>{group.label}</SelectLabel>
                {group.options.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            ))}
          </SelectContent>
        </Select>
        <HelperText>Les leads sont inscrits au moment où cet événement se produit.</HelperText>
      </div>

      {trigger?.type === 'lead_property_changed' && (
        <div className="space-y-1.5">
          <Label>Propriétés surveillées</Label>
          <MultiSelect
            items={fieldItems}
            value={(trigger.watchedFields ?? []).map(encodeField)}
            onValueChange={(keys) =>
              setTrigger({
                ...trigger,
                watchedFields: keys.length > 0 ? keys.map(decodeField) : undefined,
              })
            }
            placeholder="Toutes les propriétés"
            className="w-full"
          />
          <HelperText>Vide = tout changement de propriété déclenche.</HelperText>
        </div>
      )}

      {trigger?.type === 'list_membership_changed' && (
        <div className="space-y-1.5">
          <Label>Liste concernée</Label>
          <SegmentedControl
            aria-label="Ajout ou retrait"
            items={[
              { value: 'added', label: 'Ajouté' },
              { value: 'removed', label: 'Retiré' },
            ]}
            value={trigger.change}
            onChange={(change) => setTrigger({ ...trigger, change })}
          />
          <Select
            value={(trigger.listId as string | undefined) ?? ANY}
            onValueChange={(v) =>
              setTrigger({ ...trigger, listId: v === ANY ? undefined : (v as never) })
            }
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>Toutes les listes</SelectItem>
              {lists.map((l) => (
                <SelectItem key={l._id} value={l._id}>
                  {l.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {(trigger?.type === 'campaign_email_event' ||
        trigger?.type === 'campaign_sms_event' ||
        trigger?.type === 'tracked_link_click') && (
        <div className="space-y-1.5">
          <Label>Campagne concernée</Label>
          <Select
            value={(trigger.campaignId as string | undefined) ?? ANY}
            onValueChange={(v) =>
              setTrigger({ ...trigger, campaignId: v === ANY ? undefined : (v as never) })
            }
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>Toutes les campagnes</SelectItem>
              {campaignItems.map((c) => (
                <SelectItem key={c.value} value={c.value}>
                  {c.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {(trigger?.type === 'deal_created' ||
        trigger?.type === 'deal_stage_changed' ||
        trigger?.type === 'deal_won' ||
        trigger?.type === 'deal_lost') && (
        <div className="space-y-1.5">
          <Label>Pipeline concerné</Label>
          <Select
            value={(trigger.pipelineId as string | undefined) ?? ANY}
            onValueChange={(v) =>
              setTrigger({
                ...trigger,
                pipelineId: v === ANY ? undefined : (v as never),
                ...(trigger.type === 'deal_stage_changed' ? { stageKey: undefined } : {}),
              })
            }
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>Tous les pipelines</SelectItem>
              {pipelines.map((p) => (
                <SelectItem key={p._id} value={p._id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {trigger.type === 'deal_stage_changed' ? (
            <>
              <Label>Stade atteint</Label>
              <Select
                value={trigger.stageKey ?? ANY}
                onValueChange={(v) =>
                  setTrigger({ ...trigger, stageKey: v === ANY ? undefined : v })
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANY}>Tous les stades</SelectItem>
                  {(trigger.pipelineId
                    ? (pipelineById.get(trigger.pipelineId)?.stages ?? [])
                    : pipelines.flatMap((p) => p.stages)
                  )
                    .filter((s, i, all) => all.findIndex((o) => o.key === s.key) === i)
                    .map((s) => (
                      <SelectItem key={s.key} value={s.key}>
                        {s.label}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </>
          ) : null}
        </div>
      )}

      <div className="space-y-2">
        <Label>Critères d’inscription (optionnel)</Label>
        <HelperText>
          Seuls les leads correspondant à ces critères seront inscrits.
          {countActiveRules(criteriaDraft) === 0 ? ' Aucun critère actif pour l’instant.' : ''}
        </HelperText>
        <div className="space-y-3">
          <AdvancedFilterGroupsEditor
            value={criteriaDraft}
            onChange={(next) => {
              setCriteriaDraft(next);
              onChange({
                ...value,
                enrollmentCriteria: countActiveRules(next) > 0 ? next : undefined,
              });
            }}
            catalog={leadCatalog}
          />
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 rounded-lg border bg-card p-3">
        <div>
          <div className="text-[13px] font-semibold text-ink">Autoriser la réinscription</div>
          <HelperText>Un lead peut repasser par le workflow à chaque déclenchement.</HelperText>
        </div>
        <Switch
          checked={value.allowReEnrollment}
          onCheckedChange={(checked) => onChange({ ...value, allowReEnrollment: checked })}
        />
      </div>
    </div>
  );
}
