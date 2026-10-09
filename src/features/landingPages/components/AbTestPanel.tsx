import { useEffect, useState } from 'react';
import { useAuthMutation, useAuthQuery } from '@crm/widgets';
import { api, follows, testShareSchema } from '@crm/lib/backend';
import type { Id, LandingSection } from '@crm/lib/backend';
import { Button, Card, HelperText, Input, Label, Spinner, toast } from '@crm/design-system';
import { dateFormat } from '@crm/lib/format';
import { FlaskConical, Trophy } from 'lucide-react';
import { numberFormat } from '@crm/lib/format';
import { pageErrorMessage } from '../lib/errors';
import { copySections } from '../lib/templates';
import { SectionEditor } from './SectionEditor';
import type { FormOption } from './SectionFields';

interface AbTestPanelProps {
  pageId: Id<'landingPages'>;
  /** A's blocks, as saved: what B starts from. */
  sections: LandingSection[];
  test: { sections: LandingSection[]; share: number; startedAt: number } | undefined;
  forms: FormOption[];
}

/** Below this many views per version, a difference is mostly chance. */
const ENOUGH_VIEWS = 100;

/** What a variant got, and its conversion. */
function VariantStat({
  label,
  views,
  submissions,
}: {
  label: string;
  views: number;
  submissions: number;
}) {
  const rate = views > 0 ? (submissions / views) * 100 : 0;
  return (
    <div className="rounded-lg border px-4 py-3">
      <div className="text-[12.5px] font-medium text-faint">{label}</div>
      <div className="mt-1 font-mono text-xl font-bold text-ink">{rate.toFixed(1)}%</div>
      <div className="text-xs text-soft">
        {numberFormat.format(submissions)} envoi(s) sur {numberFormat.format(views)} vue(s)
      </div>
    </div>
  );
}

/** The A/B test of a page: B's blocks edited here, the share of visitors who see them, what each variant brought in, and the winner to keep. */
export function AbTestPanel({ pageId, sections, test, forms }: AbTestPanelProps) {
  const setTest = useAuthMutation(api.features.landingPages.mutations.setLandingPageTest);
  const chooseWinner = useAuthMutation(api.features.landingPages.mutations.chooseLandingPageWinner);
  const stats = useAuthQuery(api.features.landingPages.queries.getLandingPageStats, { pageId });
  const [draft, setDraft] = useState<{ sections: LandingSection[]; share: number } | undefined>(
    test,
  );
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);

  // The panel starts from the saved test; a test stopped or won elsewhere empties it.
  useEffect(() => {
    if (!test) {
      setDraft(undefined);
      setDirty(false);
    }
  }, [test]);

  const run = async (work: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try {
      await work();
      setDirty(false);
      toast.success(done);
    } catch (error) {
      toast.error(pageErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  if (!draft) {
    return (
      <Card className="flex flex-col items-start gap-3 p-5">
        <h2 className="text-[15px] font-bold text-ink">Test A/B</h2>
        <p className="text-sm text-soft">
          Une seconde version de la page, montrée à une part des visiteurs : la conversion de chaque
          version se mesure ici, puis vous gardez la meilleure.
        </p>
        <Button
          onClick={() => {
            setDraft({ sections: copySections(sections), share: 50 });
            setDirty(true);
          }}
        >
          <FlaskConical className="size-4" />
          Lancer un test A/B
        </Button>
      </Card>
    );
  }

  const shareValid = follows(testShareSchema, draft.share);
  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-col gap-3 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-[15px] font-bold text-ink">Test A/B</h2>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() =>
                run(() => setTest({ pageId, test: null }), 'Test arrêté : la version A reste.')
              }
            >
              Arrêter le test
            </Button>
            <Button
              disabled={busy || !dirty || !shareValid}
              onClick={() =>
                run(
                  () => setTest({ pageId, test: draft }),
                  test ? 'Nouveau test enregistré : les compteurs repartent.' : 'Test enregistré.',
                )
              }
              data-testid="save-test"
            >
              {test ? 'Enregistrer comme nouveau test' : 'Enregistrer le test'}
            </Button>
          </div>
        </div>
        <div className="max-w-xs space-y-1">
          <Label htmlFor="test-share">Part des visiteurs qui voient la version B</Label>
          <Input
            id="test-share"
            type="number"
            min={1}
            max={99}
            value={draft.share}
            onChange={(e) => {
              setDraft({ ...draft, share: Number(e.target.value) });
              setDirty(true);
            }}
          />
          <HelperText>
            De 1 à 99 %. Un visiteur voit toujours la même version, reconnue par son adresse et son
            navigateur, sans rien stocker : une adresse qui change (réseau mobile, VPN) peut changer
            de version, et un bureau derrière une seule adresse voit la même. Changer B ou la part
            relance un test, aux compteurs à zéro.
          </HelperText>
        </div>
        {stats === undefined ? (
          <Spinner size="sm" />
        ) : stats?.test ? (
          <div className="flex flex-col gap-2">
            <p className="text-xs text-faint">
              Depuis le {dateFormat.format(stats.test.startedAt)}, ce test seulement.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <VariantStat label="Version A" {...stats.test.variants.a} />
              <VariantStat label="Version B" {...stats.test.variants.b} />
            </div>
            {Math.min(stats.test.variants.a.views, stats.test.variants.b.views) < ENOUGH_VIEWS && (
              <p className="text-xs text-warning">
                Moins de {ENOUGH_VIEWS} vues sur une version : trop tôt pour conclure, l’écart tient
                surtout au hasard.
              </p>
            )}
          </div>
        ) : null}
        {test && (
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={busy}
              onClick={() =>
                run(() => chooseWinner({ pageId, winner: 'a' }), 'La version A est gardée.')
              }
            >
              <Trophy className="size-4" />
              Garder A
            </Button>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() =>
                run(
                  () => chooseWinner({ pageId, winner: 'b' }),
                  'La version B est gardée : ses blocs sont ceux de la page.',
                )
              }
            >
              <Trophy className="size-4" />
              Garder B
            </Button>
          </div>
        )}
      </Card>
      <section className="flex flex-col gap-3">
        <h2 className="text-[15px] font-bold text-ink">Blocs de la version B</h2>
        <SectionEditor
          sections={draft.sections}
          onChange={(next) => {
            setDraft({ ...draft, sections: next });
            setDirty(true);
          }}
          forms={forms}
        />
      </section>
    </div>
  );
}
