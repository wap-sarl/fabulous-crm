import { useEffect, useMemo, useState } from 'react';
import { useAuthMutation, useAuthQuery } from '@crm/widgets';
import { api } from '@crm/lib/backend';
import type { LifecycleStage } from '@crm/lib/backend';
import { LIFECYCLE_STAGE_KEY_RE, MAX_LIFECYCLE_STAGES } from '@crm/lib/backend';
import {
  Button,
  Card,
  HelperText,
  IconButton,
  Input,
  Label,
  PageHeader,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Spinner,
  Switch,
  toast,
} from '@crm/design-system';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { usePageTitle } from '../../layouts/DashboardShell';

/** Derive a stage key from its label: accent-free, lowercase, `_`-joined. */
function keyFromLabel(label: string, taken: Set<string>): string {
  const base =
    label
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 24) || 'etape';
  let key = base;
  for (let i = 2; taken.has(key); i++) key = `${base}_${i}`;
  return key;
}

const ERROR_MESSAGES: Record<string, string> = {
  lifecycle_no_stages: 'Au moins une étape est requise.',
  lifecycle_too_many_stages: `Au plus ${MAX_LIFECYCLE_STAGES} étapes.`,
  lifecycle_invalid_key: 'Identifiant d’étape invalide.',
  lifecycle_duplicate_key: 'Deux étapes partagent le même identifiant.',
  lifecycle_empty_label: 'Chaque étape doit avoir un libellé.',
  lifecycle_invalid_default: 'L’étape par défaut doit être une étape de la liste.',
  lifecycle_stage_in_use:
    'Impossible de supprimer une étape à laquelle des leads se trouvent encore.',
};

export function LifecyclePage() {
  usePageTitle('Cycle de vie');
  const config = useAuthQuery(api.features.config.queries.getLifecycleConfig, {});
  const counts = useAuthQuery(api.features.crm.queries.countLeadsByLifecycleStage, {});
  const updateLifecycleConfig = useAuthMutation(
    api.features.config.mutations.updateLifecycleConfig,
  );

  const [stages, setStages] = useState<LifecycleStage[]>([]);
  const [defaultStage, setDefaultStage] = useState('');
  const [allowRegression, setAllowRegression] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  // Load the stored config into the form once (and again after a save resets `dirty`).
  useEffect(() => {
    if (!config || dirty) return;
    setStages(config.stages);
    setDefaultStage(config.defaultStage);
    setAllowRegression(config.allowRegression);
  }, [config, dirty]);

  const total = useMemo(
    () => (counts ? Object.values(counts.byStage).reduce((a, b) => a + b, 0) + counts.unset : 0),
    [counts],
  );
  const maxCount = useMemo(
    () => (counts ? Math.max(1, ...Object.values(counts.byStage)) : 1),
    [counts],
  );

  const touch =
    <T,>(setter: (v: T) => void) =>
    (v: T) => {
      setter(v);
      setDirty(true);
    };

  const move = (index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (target < 0 || target >= stages.length) return;
    const next = [...stages];
    [next[index], next[target]] = [next[target], next[index]];
    touch(setStages)(next);
  };

  const rename = (index: number, label: string) =>
    touch(setStages)(stages.map((s, i) => (i === index ? { ...s, label } : s)));

  const remove = (index: number) => {
    const stage = stages[index];
    if ((counts?.byStage[stage.key] ?? 0) > 0) {
      toast.error(ERROR_MESSAGES.lifecycle_stage_in_use);
      return;
    }
    const next = stages.filter((_, i) => i !== index);
    touch(setStages)(next);
    if (defaultStage === stage.key) setDefaultStage(next[0]?.key ?? '');
  };

  const add = () => {
    const label = newLabel.trim();
    if (!label) return;
    if (stages.length >= MAX_LIFECYCLE_STAGES) {
      toast.error(ERROR_MESSAGES.lifecycle_too_many_stages);
      return;
    }
    const key = keyFromLabel(label, new Set(stages.map((s) => s.key)));
    touch(setStages)([...stages, { key, label }]);
    setNewLabel('');
  };

  const save = async () => {
    if (stages.some((s) => !s.label.trim())) {
      toast.error(ERROR_MESSAGES.lifecycle_empty_label);
      return;
    }
    if (stages.some((s) => !LIFECYCLE_STAGE_KEY_RE.test(s.key))) {
      toast.error(ERROR_MESSAGES.lifecycle_invalid_key);
      return;
    }
    setSaving(true);
    try {
      await updateLifecycleConfig({ stages, defaultStage, allowRegression });
      setDirty(false);
      toast.success('Cycle de vie enregistré.');
    } catch (e) {
      const message = e instanceof Error ? e.message : '';
      const known = Object.keys(ERROR_MESSAGES).find((k) => message.includes(k));
      toast.error(known ? ERROR_MESSAGES[known] : 'Échec de l’enregistrement.');
    } finally {
      setSaving(false);
    }
  };

  if (config === undefined) {
    return (
      <div className="flex justify-center py-12">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-8">
      <PageHeader
        title="Cycle de vie"
        subtitle="Étapes du parcours marketing → commercial, dans l’ordre de l’entonnoir"
        actions={
          <Button onClick={save} loading={saving} disabled={!dirty} data-testid="save-lifecycle">
            Enregistrer
          </Button>
        }
      />

      <div className="mt-6 flex flex-col gap-5">
        <Card className="p-5">
          <h2 className="mb-1 text-[15px] font-bold text-ink">Entonnoir</h2>
          <p className="mb-4 text-sm text-faint">
            {counts ? `${total} lead(s) actif(s)` : 'Chargement…'}
            {counts && counts.unset > 0 ? ` · ${counts.unset} sans étape (migration à lancer)` : ''}
          </p>
          <ul className="flex flex-col gap-2" data-testid="lifecycle-funnel">
            {stages.map((stage) => {
              const n = counts?.byStage[stage.key] ?? 0;
              return (
                <li key={stage.key} className="flex items-center gap-3 text-sm">
                  <span className="w-36 shrink-0 truncate font-medium text-ink">{stage.label}</span>
                  <span className="h-5 flex-1 overflow-hidden rounded bg-[#F2F3F5]">
                    <span
                      className="block h-full rounded bg-primary/70"
                      style={{ width: `${Math.round((n / maxCount) * 100)}%` }}
                    />
                  </span>
                  <span className="w-14 shrink-0 text-right font-mono text-xs text-soft">{n}</span>
                </li>
              );
            })}
          </ul>
        </Card>

        <Card className="p-5">
          <h2 className="mb-1 text-[15px] font-bold text-ink">Étapes</h2>
          <p className="mb-4 text-sm text-faint">
            L’ordre de la liste est l’ordre de l’entonnoir. Une étape ne peut être supprimée que si
            aucun lead ne s’y trouve.
          </p>
          <ul className="flex flex-col gap-2">
            {stages.map((stage, index) => (
              <li key={stage.key} className="flex items-center gap-2" data-testid="lifecycle-stage">
                <span className="w-6 text-right font-mono text-xs text-faint">{index + 1}</span>
                <Input
                  value={stage.label}
                  onChange={(e) => rename(index, e.target.value)}
                  aria-label={`Libellé de l’étape ${index + 1}`}
                  className="flex-1"
                />
                <span className="w-28 truncate font-mono text-xs text-faint" title={stage.key}>
                  {stage.key}
                </span>
                <IconButton
                  variant="secondary"
                  size="sm"
                  aria-label="Monter"
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                >
                  <ArrowUp className="size-4" />
                </IconButton>
                <IconButton
                  variant="secondary"
                  size="sm"
                  aria-label="Descendre"
                  disabled={index === stages.length - 1}
                  onClick={() => move(index, 1)}
                >
                  <ArrowDown className="size-4" />
                </IconButton>
                <IconButton
                  variant="secondary"
                  size="sm"
                  aria-label={`Supprimer l’étape ${stage.label}`}
                  disabled={stages.length <= 1 || (counts?.byStage[stage.key] ?? 0) > 0}
                  onClick={() => remove(index)}
                >
                  <Trash2 className="size-4" />
                </IconButton>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex items-center gap-2">
            <Input
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  add();
                }
              }}
              placeholder="Nouvelle étape…"
              aria-label="Libellé de la nouvelle étape"
              className="flex-1"
              data-testid="new-lifecycle-stage"
            />
            <Button variant="outline" onClick={add} disabled={!newLabel.trim()}>
              <Plus className="size-4" />
              Ajouter
            </Button>
          </div>
        </Card>

        <Card className="flex flex-col gap-4 p-5">
          <div className="space-y-1.5">
            <Label>Étape par défaut des nouveaux leads</Label>
            <Select value={defaultStage} onValueChange={touch(setDefaultStage)}>
              <SelectTrigger className="w-full sm:w-72">
                <SelectValue placeholder="Choisir…" />
              </SelectTrigger>
              <SelectContent>
                {stages.map((s) => (
                  <SelectItem key={s.key} value={s.key}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <HelperText>Appliquée aux leads créés sans étape (formulaire, import CSV).</HelperText>
          </div>

          <label className="flex items-start gap-3 text-sm">
            <Switch
              checked={allowRegression}
              onCheckedChange={touch(setAllowRegression)}
              aria-label="Autoriser le retour en arrière"
              data-testid="allow-regression"
            />
            <span className="flex flex-col gap-0.5">
              <span className="font-medium text-ink">Autoriser le retour en arrière</span>
              <span className="text-faint">
                Désactivé: un lead ne peut pas revenir à une étape antérieure, ni manuellement ni
                par workflow.
              </span>
            </span>
          </label>
        </Card>
      </div>
    </div>
  );
}
