import { Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '@crm/widgets';
import { Card } from '@crm/design-system';
import { canAccessModule, moduleOfPath } from '../lib/constants';

export function RequireModule() {
  const { user } = useAuth();
  const { pathname } = useLocation();
  const module = moduleOfPath(pathname);
  if (module && user && !canAccessModule(user.access, module)) {
    return (
      <div className="mx-auto w-full max-w-xl px-6 py-12">
        <Card className="p-8 text-center text-sm text-faint" data-testid="module-denied">
          Ce module n’est pas accessible avec votre rôle.
        </Card>
      </div>
    );
  }
  return <Outlet />;
}
