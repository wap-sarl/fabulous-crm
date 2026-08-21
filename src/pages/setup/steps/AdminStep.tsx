import { Input, Label } from '@crm/design-system';
import type { StepProps } from './types';

export function AdminStep({ data, update, error }: StepProps) {
  const setAdmin = (patch: Partial<typeof data.admin>) =>
    update({ admin: { ...data.admin, ...patch } });

  return (
    <div className="space-y-4">
      <p className="text-sm text-soft">
        Ce compte sera créé comme administrateur et connecté immédiatement.
      </p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="adminFirstName">Prénom</Label>
          <Input
            id="adminFirstName"
            size="lg"
            value={data.admin.firstName}
            onChange={(e) => setAdmin({ firstName: e.target.value })}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="adminLastName">Nom</Label>
          <Input
            id="adminLastName"
            size="lg"
            value={data.admin.lastName}
            onChange={(e) => setAdmin({ lastName: e.target.value })}
          />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="adminEmail">Adresse e-mail</Label>
        <Input
          id="adminEmail"
          type="email"
          size="lg"
          value={data.admin.email}
          onChange={(e) => setAdmin({ email: e.target.value })}
        />
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
