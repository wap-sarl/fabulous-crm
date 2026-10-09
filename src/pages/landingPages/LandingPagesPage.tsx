import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthQuery } from '@crm/widgets';
import { api } from '@crm/lib/backend';
import { Button, Card, PageHeader, Spinner, StatusBadge } from '@crm/design-system';
import { Plus } from 'lucide-react';
import { usePageTitle } from '../../layouts/DashboardShell';
import { NewLandingPageDialog } from '../../features/landingPages/components/NewLandingPageDialog';
import { dateFormat, numberFormat } from '@crm/lib/format';

/** The hosted pages, newest first, with their last thirty days. */
export function LandingPagesPage() {
  usePageTitle('Pages');
  const navigate = useNavigate();
  const pages = useAuthQuery(api.features.landingPages.queries.listLandingPages, {});
  const [creating, setCreating] = useState(false);

  return (
    <div className="flex flex-col">
      <PageHeader
        className="px-5 sm:px-7"
        title="Pages"
        subtitle="Des pages hébergées ici, avec vos formulaires, sans développeur"
        actions={
          <Button onClick={() => setCreating(true)} data-testid="new-page">
            <Plus className="h-4 w-4" />
            Nouvelle page
          </Button>
        }
      />
      <div className="px-5 pb-6 sm:px-7">
        {pages === undefined ? (
          <Spinner size="sm" />
        ) : pages.length === 0 ? (
          <p className="text-sm text-soft">
            Aucune page. Créez-en une depuis un modèle, publiez-la, et suivez ses vues et ses
            envois.
          </p>
        ) : (
          <Card className="divide-y divide-border p-0">
            {pages.map((page) => (
              <button
                key={page._id}
                type="button"
                onClick={() => navigate(`/pages/${page._id}`)}
                className="flex w-full cursor-pointer items-center gap-4 px-4 py-3 text-left hover:bg-secondary"
                data-testid="landing-page-row"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-ink">{page.name}</p>
                  <p className="truncate font-mono text-xs text-faint">/p/{page.slug}</p>
                </div>
                <span className="hidden text-xs text-soft sm:block">
                  {numberFormat.format(page.views)} vue(s) · {numberFormat.format(page.submissions)}{' '}
                  envoi(s)
                </span>
                <span className="hidden font-mono text-xs text-faint md:block">
                  {dateFormat.format(page.updatedAt)}
                </span>
                <StatusBadge tone={page.status === 'published' ? 'green' : 'gray'} withDot>
                  {page.status === 'published' ? 'Publiée' : 'Brouillon'}
                </StatusBadge>
              </button>
            ))}
          </Card>
        )}
      </div>
      <NewLandingPageDialog
        open={creating}
        onOpenChange={setCreating}
        onCreated={(pageId) => navigate(`/pages/${pageId}`)}
      />
    </div>
  );
}
