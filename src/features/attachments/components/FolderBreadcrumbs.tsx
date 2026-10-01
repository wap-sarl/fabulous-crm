import { cn } from '@crm/design-system';
import { ChevronRight } from 'lucide-react';
import { ROOT_LABEL, breadcrumbs } from '../lib/files';

interface FolderBreadcrumbsProps {
  showTrash: boolean;
  folder: string;
  setFolder: (folder: string) => void;
}

export function FolderBreadcrumbs({ showTrash, folder, setFolder }: FolderBreadcrumbsProps) {
  return (
    <nav
      className={cn(
        'mb-2 flex flex-wrap items-center gap-1 text-xs text-faint',
        showTrash && 'hidden',
      )}
      aria-label="Dossier"
    >
      <button
        type="button"
        onClick={() => setFolder('')}
        className={cn('hover:text-ink', folder === '' && 'font-semibold text-ink')}
      >
        {ROOT_LABEL}
      </button>
      {breadcrumbs(folder).map((crumb, i, arr) => (
        <span key={crumb.path} className="flex items-center gap-1">
          <ChevronRight className="size-3" aria-hidden />
          <button
            type="button"
            onClick={() => setFolder(crumb.path)}
            className={cn('hover:text-ink', i === arr.length - 1 && 'font-semibold text-ink')}
          >
            {crumb.label}
          </button>
        </span>
      ))}
    </nav>
  );
}
