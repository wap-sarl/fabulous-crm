import { AB_SPLIT_MAX, AB_SPLIT_MIN, AB_WINDOW_HOURS_MAX } from '@crm/lib/backend';
import { HelperText, Input, Label, SegmentedControl, Switch } from '@crm/design-system';
import type { AbTestForm } from '../lib/delivery';
import { EmailBodyEditor } from './EmailBodyEditor';

/** The A/B test of a custom e-mail: what B changes, the share of the audience that tests, how long, and what decides. */
export function AbTestFields({
  form,
  onChange,
  placeholders,
  available,
}: {
  form: AbTestForm;
  onChange: (next: AbTestForm) => void;
  placeholders: { label: string; token: string }[];
  available: boolean;
}) {
  const set = <K extends keyof AbTestForm>(key: K, value: AbTestForm[K]) =>
    onChange({ ...form, [key]: value });
  return (
    <div className="flex flex-col gap-4">
      <span className="text-sm font-semibold text-ink">Test A/B</span>
      <div className="flex items-start gap-3">
        <Switch
          id="campaign-ab"
          checked={form.enabled && available}
          disabled={!available}
          onCheckedChange={(enabled) => set('enabled', enabled)}
          className="mt-0.5"
        />
        <div className="space-y-0.5">
          <Label htmlFor="campaign-ab">Tester deux variantes</Label>
          <HelperText>
            {available
              ? 'Une part des destinataires reçoit A ou B ; à la fin de la fenêtre, le reste reçoit la variante qui a le mieux marché.'
              : 'Disponible pour un e-mail rédigé dans l’éditeur.'}
          </HelperText>
        </div>
      </div>
      {form.enabled && available && (
        <div className="flex flex-col gap-4 rounded-xl border bg-card p-4">
          <div className="space-y-1.5">
            <span className="text-sm font-medium text-ink">Ce que B change</span>
            <SegmentedControl
              aria-label="Ce que la variante B change"
              items={[
                { value: 'subject', label: 'L’objet' },
                { value: 'content', label: 'Le contenu' },
              ]}
              value={form.kind}
              onChange={(kind) => set('kind', kind)}
            />
          </div>
          {form.kind === 'subject' ? (
            <div className="space-y-1.5">
              <Label htmlFor="campaign-subject-b">Objet de la variante B</Label>
              <Input
                id="campaign-subject-b"
                value={form.subjectB}
                onChange={(e) => set('subjectB', e.target.value)}
                placeholder="Un autre objet, le même e-mail"
              />
            </div>
          ) : (
            <div className="space-y-1.5">
              <span className="text-sm font-medium text-ink">Contenu de la variante B</span>
              <EmailBodyEditor
                value={form.htmlBodyB}
                onChange={(html) => set('htmlBodyB', html)}
                placeholders={placeholders}
              />
            </div>
          )}
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="campaign-ab-split">Part testée (%)</Label>
              <Input
                id="campaign-ab-split"
                type="number"
                min={AB_SPLIT_MIN}
                max={AB_SPLIT_MAX}
                value={form.splitPercent}
                onChange={(e) => set('splitPercent', e.target.value)}
              />
              <HelperText>Partagée entre A et B ; le reste attend le résultat.</HelperText>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="campaign-ab-window">Fenêtre (heures)</Label>
              <Input
                id="campaign-ab-window"
                type="number"
                min={1}
                max={AB_WINDOW_HOURS_MAX}
                value={form.windowHours}
                onChange={(e) => set('windowHours', e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <span className="text-sm font-medium text-ink">Ce qui décide</span>
              <SegmentedControl
                aria-label="La métrique qui décide"
                items={[
                  { value: 'opens', label: 'Ouvertures' },
                  { value: 'clicks', label: 'Clics' },
                ]}
                value={form.metric}
                onChange={(metric) => set('metric', metric)}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
