import { useMemo, useState } from 'react';
import { useAuthQuery } from '@crm/widgets';
import { api } from '@crm/lib/backend';
import type { Doc, Id, PropertyValue } from '@crm/lib/backend';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  SegmentedControl,
  Spinner,
  StatusBadge,
  cn,
  toast,
} from '@crm/design-system';
import { formatAddress } from '../../../lib/addresses';
import { CONSENT_CHANNEL_LABEL } from '../../../lib/constants';
import { usePropertyDefinitions } from '../../properties/hooks/usePropertyDefinitions';
import { formatPropertyValue, hasPropertyValue } from '../../properties/lib/customProperties';
import { duplicateErrorMessage, useDuplicateActions } from '../hooks/useDuplicateActions';
import { useLifecycleConfig } from '../hooks/useLifecycleConfig';
import { DUPLICATE_REASON_LABEL, DUPLICATE_REASON_TONE } from '../lib/duplicates';

type Side = 'a' | 'b';
type Enriched = { lead: Doc<'leads'>; ownerNames: string[]; companyName: string | null };

const dateFormat = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium' });

/** One comparable row: how to read each side and how to express "take the other side". */
interface FieldRow {
  key: string;
  label: string;
  display: (side: Enriched) => string;
  isSet: (side: Enriched) => boolean;
  /** Value sent to mergeLeads when the survivor takes this field from the other lead. */
  pick: (from: Enriched) => Record<string, unknown>;
}

interface MergeLeadsDialogProps {
  pairId: Id<'leadDuplicates'> | null;
  onClose: () => void;
  onMerged?: (survivorId: Id<'leads'>) => void;
}

/** Side-by-side comparison of a duplicate pair: choose the surviving lead and, field by field, the value to keep. */
export function MergeLeadsDialog({ pairId, onClose, onMerged }: MergeLeadsDialogProps) {
  const data = useAuthQuery(
    api.features.duplicates.queries.getDuplicatePair,
    pairId ? { pairId } : 'skip',
  );
  return (
    <Dialog open={pairId !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-3xl">
        {data === undefined ? (
          <div className="flex justify-center py-10">
            <Spinner size="lg" />
          </div>
        ) : data === null ? (
          <p className="py-6 text-sm text-faint">Cette paire n’existe plus.</p>
        ) : (
          <MergeBody key={data.pair._id} data={data} onClose={onClose} onMerged={onMerged} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function MergeBody({
  data,
  onClose,
  onMerged,
}: {
  data: NonNullable<
    ReturnType<typeof useAuthQuery<typeof api.features.duplicates.queries.getDuplicatePair>>
  >;
  onClose: () => void;
  onMerged?: (survivorId: Id<'leads'>) => void;
}) {
  const lifecycle = useLifecycleConfig();
  const definitions = usePropertyDefinitions('lead');
  const { mergeLeads } = useDuplicateActions();
  const [survivor, setSurvivor] = useState<Side>('a');
  const [overrides, setOverrides] = useState<Record<string, Side>>({});
  const [submitting, setSubmitting] = useState(false);

  const sides: Record<Side, Enriched> = { a: data.a, b: data.b };
  const other: Side = survivor === 'a' ? 'b' : 'a';

  const rows = useMemo<FieldRow[]>(() => {
    const text = (key: keyof Doc<'leads'> & string, label: string, clearable = true): FieldRow => ({
      key,
      label,
      display: (s) => String(s.lead[key] ?? '') || '—',
      isSet: (s) => !!s.lead[key],
      pick: (from) => ({ [key]: from.lead[key] ?? (clearable ? null : undefined) }),
    });
    const base: FieldRow[] = [
      text('firstName', 'Prénom', false),
      text('lastName', 'Nom', false),
      text('email', 'E-mail'),
      text('phone', 'Téléphone'),
      {
        key: 'address',
        label: 'Adresse',
        display: (s) => (s.lead.address ? formatAddress(s.lead.address) : '—'),
        isSet: (s) => !!s.lead.address,
        pick: (from) => ({ address: from.lead.address ?? null }),
      },
      text('comment', 'Commentaire'),
      {
        key: 'ownerIds',
        label: 'Propriétaires',
        display: (s) => s.ownerNames.join(', ') || '—',
        isSet: (s) => s.lead.ownerIds.length > 0,
        pick: (from) => ({ ownerIds: from.lead.ownerIds }),
      },
      {
        key: 'companyId',
        label: 'Entreprise',
        display: (s) => s.companyName ?? '—',
        isSet: (s) => !!s.lead.companyId,
        pick: (from) => ({ companyId: from.lead.companyId ?? null }),
      },
      {
        key: 'lifecycleStage',
        label: 'Statut',
        display: (s) => lifecycle.labelOf(s.lead.lifecycleStage),
        isSet: (s) => !!s.lead.lifecycleStage,
        pick: (from) => ({ lifecycleStage: from.lead.lifecycleStage }),
      },
      {
        key: 'isRedFlagged',
        label: 'Signalé',
        display: (s) => (s.lead.isRedFlagged ? 'Oui' : 'Non'),
        isSet: (s) => s.lead.isRedFlagged,
        pick: (from) => ({ isRedFlagged: from.lead.isRedFlagged }),
      },
    ];
    const custom: FieldRow[] = definitions.map((def) => ({
      key: `cp:${def._id}`,
      label: def.label,
      display: (s) => formatPropertyValue(def, s.lead.customProperties?.[def._id]),
      isSet: (s) => hasPropertyValue(s.lead.customProperties?.[def._id]),
      // Merged below into one customProperties record.
      pick: (from) => ({ [`cp:${def._id}`]: from.lead.customProperties?.[def._id] }),
    }));
    return [...base, ...custom];
  }, [definitions, lifecycle]);

  /** Chosen side of a row: explicit choice, else the survivor unless only the other side has a value. */
  const chosen = (row: FieldRow): Side =>
    overrides[row.key] ??
    (!row.isSet(sides[survivor]) && row.isSet(sides[other]) ? other : survivor);

  const submit = async () => {
    const fields: Record<string, unknown> = {};
    const customPicked: Record<string, PropertyValue> = {
      ...(sides[survivor].lead.customProperties ?? {}),
    };
    let customChanged = false;
    for (const row of rows) {
      if (chosen(row) !== other) continue;
      if (row.key.startsWith('cp:')) {
        const defId = row.key.slice(3);
        const value = sides[other].lead.customProperties?.[defId];
        if (value === undefined) delete customPicked[defId];
        else customPicked[defId] = value;
        customChanged = true;
      } else {
        Object.assign(fields, row.pick(sides[other]));
      }
    }
    if (customChanged) fields.customProperties = customPicked;
    setSubmitting(true);
    try {
      const res = await mergeLeads({
        survivorId: sides[survivor].lead._id,
        absorbedId: sides[other].lead._id,
        fields,
      });
      toast.success('Leads fusionnés.');
      onMerged?.(res.survivorId);
      onClose();
    } catch (e) {
      toast.error(duplicateErrorMessage(e, 'Échec de la fusion.'));
    } finally {
      setSubmitting(false);
    }
  };

  const consent = (s: Enriched) =>
    s.lead.marketingConsent.map((c) => CONSENT_CHANNEL_LABEL[c]).join(', ') || '—';

  return (
    <>
      <DialogHeader>
        <DialogTitle>Fusionner deux leads</DialogTitle>
        <DialogDescription>
          <span className="flex flex-wrap gap-1.5">
            {data.pair.reasons.map((r) => (
              <StatusBadge key={r} tone={DUPLICATE_REASON_TONE[r]} withDot={false}>
                {DUPLICATE_REASON_LABEL[r]}
              </StatusBadge>
            ))}
          </span>
        </DialogDescription>
      </DialogHeader>

      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm font-medium text-ink">Fiche conservée</span>
        <SegmentedControl
          aria-label="Fiche conservée"
          items={[
            { value: 'a', label: `${sides.a.lead.firstName} ${sides.a.lead.lastName}` },
            { value: 'b', label: `${sides.b.lead.firstName} ${sides.b.lead.lastName}` },
          ]}
          value={survivor}
          onChange={(v) => {
            setSurvivor(v);
            setOverrides({});
          }}
        />
        <span className="text-xs text-faint">
          L’autre fiche est supprimée ; ses notes, activités, transactions, envois et listes sont
          rattachés à la fiche conservée.
        </span>
      </div>

      <div className="max-h-[55vh] overflow-y-auto rounded-md border border-border">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-[#F7F8FA] text-xs text-faint">
            <tr>
              <th className="w-36 px-3 py-2 text-left font-medium">Champ</th>
              {(['a', 'b'] as const).map((side) => (
                <th key={side} className="px-3 py-2 text-left font-medium">
                  <span className="block text-ink">
                    {sides[side].lead.firstName} {sides[side].lead.lastName}
                  </span>
                  <span className="block font-normal">
                    Créé le {dateFormat.format(sides[side].lead._creationTime)}
                    {side === survivor ? ' · conservé' : ''}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((row) => {
              const same = row.display(sides.a) === row.display(sides.b);
              const pick = chosen(row);
              return (
                <tr key={row.key} data-testid={`merge-row-${row.key}`}>
                  <td className="px-3 py-2 align-top text-xs font-medium text-soft">{row.label}</td>
                  {(['a', 'b'] as const).map((side) => (
                    <td key={side} className="px-3 py-1.5 align-top">
                      {same ? (
                        <span className="block py-1 text-ink">{row.display(sides[side])}</span>
                      ) : (
                        <label
                          className={cn(
                            'flex cursor-pointer items-start gap-2 rounded-md px-2 py-1 transition-colors',
                            pick === side
                              ? 'bg-primary/10 text-ink'
                              : 'text-faint hover:bg-[#F7F8FA]',
                          )}
                        >
                          <input
                            type="radio"
                            name={`merge-${row.key}`}
                            className="mt-1 size-3.5 accent-primary"
                            checked={pick === side}
                            onChange={() => setOverrides((prev) => ({ ...prev, [row.key]: side }))}
                          />
                          <span className="break-words">{row.display(sides[side])}</span>
                        </label>
                      )}
                    </td>
                  ))}
                </tr>
              );
            })}
            <tr>
              <td className="px-3 py-2 align-top text-xs font-medium text-soft">Consentement</td>
              <td className="px-3 py-2 text-ink">{consent(sides.a)}</td>
              <td className="px-3 py-2 text-ink">{consent(sides.b)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="text-xs text-faint">
        Le consentement marketing est l’union des deux fiches (la personne est la même).
      </p>

      <DialogFooter>
        <Button variant="ghost" onClick={onClose} disabled={submitting}>
          Annuler
        </Button>
        <Button onClick={submit} loading={submitting} data-testid="confirm-merge">
          Fusionner
        </Button>
      </DialogFooter>
    </>
  );
}
