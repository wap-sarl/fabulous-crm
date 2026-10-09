import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuthMutation, useAuthQuery } from '@crm/widgets';
import { api, validateLandingPageShape } from '@crm/lib/backend';
import type { Id, LandingVariant } from '@crm/lib/backend';
import {
  Button,
  Card,
  ConfirmDialog,
  PageHeader,
  SegmentedControl,
  Spinner,
  StatusBadge,
  toast,
} from '@crm/design-system';
import { ExternalLink, Save, Trash2 } from 'lucide-react';
import { usePageTitle } from '../../layouts/DashboardShell';
import { AbTestPanel } from '../../features/landingPages/components/AbTestPanel';
import { PagePreview } from '../../features/landingPages/components/PagePreview';
import { PageSettingsFields } from '../../features/landingPages/components/PageSettingsFields';
import { PageStatsCard } from '../../features/landingPages/components/PageStatsCard';
import { SectionEditor } from '../../features/landingPages/components/SectionEditor';
import { pageErrorMessage } from '../../features/landingPages/lib/errors';
import type { PageDraft } from '../../features/landingPages/types';

type Tab = 'content' | 'test' | 'preview' | 'stats';

const TABS = [
  { value: 'content', label: 'Contenu' },
  { value: 'test', label: 'Test A/B' },
  { value: 'preview', label: 'Aperçu' },
  { value: 'stats', label: 'Statistiques' },
];

/** One page: its blocks and settings, what it looks like, and what it brought in; publishing is a switch of its own. */
export function LandingPageEditorPage() {
  usePageTitle('Page');
  const navigate = useNavigate();
  const { pageId } = useParams<{ pageId: string }>();
  const id = pageId as Id<'landingPages'>;
  const data = useAuthQuery(api.features.landingPages.queries.getLandingPage, { pageId: id });
  const forms = useAuthQuery(api.features.forms.queries.listFormOptions, {}) ?? [];
  const updatePage = useAuthMutation(api.features.landingPages.mutations.updateLandingPage);
  const setStatus = useAuthMutation(api.features.landingPages.mutations.setLandingPageStatus);
  const deletePage = useAuthMutation(api.features.landingPages.mutations.deleteLandingPage);

  const [tab, setTab] = useState<Tab>('content');
  const [draft, setDraft] = useState<PageDraft | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [previewVariant, setPreviewVariant] = useState<LandingVariant>('a');

  // The editor starts from the page once it is loaded; what someone else saves meanwhile is left alone until a reload.
  useEffect(() => {
    if (data && !draft) {
      const { name, slug, seo, sections } = data.page;
      setDraft({ name, slug, seo, sections });
    }
  }, [data, draft]);

  const change = (next: PageDraft) => {
    setDraft(next);
    setDirty(true);
  };

  const save = async () => {
    if (!draft) return false;
    // The backend's own rule, asked first: a page that would be refused is not sent.
    const shape = validateLandingPageShape(draft);
    if (shape) {
      toast.error(pageErrorMessage(shape));
      return false;
    }
    setBusy(true);
    try {
      await updatePage({ pageId: id, ...draft });
      setDirty(false);
      toast.success('Page enregistrée.');
      return true;
    } catch (error) {
      toast.error(pageErrorMessage(error));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const publish = async (status: 'draft' | 'published') => {
    if (dirty && !(await save())) return;
    setBusy(true);
    try {
      await setStatus({ pageId: id, status });
      toast.success(status === 'published' ? 'Page publiée.' : 'Page dépubliée.');
    } catch (error) {
      toast.error(pageErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    try {
      await deletePage({ pageId: id });
      toast.success('Page supprimée.');
      navigate('/pages');
    } catch (error) {
      toast.error(pageErrorMessage(error));
    }
  };

  if (data === undefined || !draft) {
    return (
      <div className="flex justify-center py-12">
        <Spinner size="lg" />
      </div>
    );
  }
  if (data === null) return <p className="p-7 text-faint">Page introuvable.</p>;
  const published = data.page.status === 'published';

  return (
    <div className="flex flex-col">
      <PageHeader
        className="px-5 sm:px-7"
        title={draft.name || 'Page'}
        onBack={() => navigate('/pages')}
        subtitle={
          <span className="inline-flex items-center gap-2">
            <StatusBadge tone={published ? 'green' : 'gray'} withDot>
              {published ? 'Publiée' : 'Brouillon'}
            </StatusBadge>
            {published && (
              <a
                href={data.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 font-mono text-xs text-primary hover:underline"
              >
                {data.url}
                <ExternalLink className="size-3" aria-hidden />
              </a>
            )}
          </span>
        }
        actions={
          <>
            <Button variant="ghost" color="destructive" onClick={() => setConfirmDelete(true)}>
              <Trash2 className="size-4" />
              Supprimer
            </Button>
            <Button
              variant="outline"
              onClick={save}
              disabled={busy || !dirty}
              data-testid="save-page"
            >
              <Save className="size-4" />
              Enregistrer
            </Button>
            {published ? (
              <Button variant="outline" onClick={() => publish('draft')} disabled={busy}>
                Dépublier
              </Button>
            ) : (
              <Button
                onClick={() => publish('published')}
                disabled={busy}
                data-testid="publish-page"
              >
                Publier
              </Button>
            )}
          </>
        }
      />
      <div className="flex flex-col gap-4 px-5 pb-6 sm:px-7">
        <SegmentedControl
          aria-label="Partie de la page"
          items={TABS}
          value={tab}
          onChange={(v) => setTab(v as Tab)}
        />
        {tab === 'content' && (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <section className="flex flex-col gap-3">
              <h2 className="text-[15px] font-bold text-ink">Blocs</h2>
              <SectionEditor
                sections={draft.sections}
                onChange={(sections) => change({ ...draft, sections })}
                forms={forms}
              />
            </section>
            <Card className="h-fit p-5">
              <h2 className="mb-3 text-[15px] font-bold text-ink">Réglages</h2>
              <PageSettingsFields draft={draft} onChange={change} />
            </Card>
          </div>
        )}
        {tab === 'test' && (
          <AbTestPanel
            pageId={id}
            sections={data.page.sections}
            test={data.page.abTest}
            forms={forms}
          />
        )}
        {tab === 'preview' && (
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-3">
              {data.page.abTest && (
                <SegmentedControl
                  aria-label="Version"
                  items={[
                    { value: 'a', label: 'Version A' },
                    { value: 'b', label: 'Version B' },
                  ]}
                  value={previewVariant}
                  onChange={(v) => setPreviewVariant(v as LandingVariant)}
                />
              )}
              {dirty && (
                <p className="text-xs text-faint">L’aperçu montre la page telle qu’enregistrée.</p>
              )}
            </div>
            <PagePreview pageId={id} variant={data.page.abTest ? previewVariant : 'a'} />
          </div>
        )}
        {tab === 'stats' && <PageStatsCard pageId={id} />}
      </div>
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Supprimer « ${draft.name} » ?`}
        description="La page ne répondra plus à son adresse ; ses statistiques sont conservées avec elle."
        confirmLabel="Supprimer la page"
        destructive
        onConfirm={remove}
      />
    </div>
  );
}
