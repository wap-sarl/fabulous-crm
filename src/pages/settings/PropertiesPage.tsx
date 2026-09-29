import { useSearchParams } from 'react-router-dom';
import type { PropertyEntityType } from '@crm/lib/backend';
import { useAuth } from '@crm/widgets';
import { PageHeader, SegmentedControl } from '@crm/design-system';
import { usePageTitle } from '../../layouts/DashboardShell';
import { PROPERTY_ENTITIES } from '../../features/properties/lib/customProperties';
import { PropertiesManager } from '../../features/properties/components/PropertiesManager';

/** Admin-only settings: define custom properties per entity (leads, companies, deals, activities). */
export function PropertiesPage() {
  usePageTitle('Propriétés');
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const entityType = (PROPERTY_ENTITIES.find((e) => e.value === searchParams.get('entity'))
    ?.value ?? 'lead') as PropertyEntityType;

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-8">
      <PageHeader
        title="Propriétés"
        subtitle="Champs personnalisés des leads, entreprises, transactions et activités"
      />
      <div className="mt-6 flex flex-col gap-4">
        <SegmentedControl
          aria-label="Entité"
          items={PROPERTY_ENTITIES.map((e) => ({ value: e.value, label: e.label }))}
          value={entityType}
          onChange={(v) => setSearchParams(v === 'lead' ? {} : { entity: v }, { replace: true })}
        />
        {user?.access.settings ? (
          <PropertiesManager entityType={entityType} />
        ) : (
          <p className="text-sm text-soft">Cette page est réservée aux administrateurs.</p>
        )}
      </div>
    </div>
  );
}
