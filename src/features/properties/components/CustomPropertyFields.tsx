import { useCallback } from 'react';
import { HelperText, Label, type RppsVerificationResult } from '@crm/design-system';
import { api } from '@crm/lib/backend';
import type { PropertyValue } from '@crm/lib/backend';
import { useAuthAction } from '@crm/widgets';
import { validatePropertyValue } from '../lib/customProperties';
import { propertyTypeUi } from '../lib/propertyTypes';
import type { PropertyDefinitionRow } from '../types';

interface Props {
  definitions: PropertyDefinitionRow[];
  values: Record<string, PropertyValue>;
  /** Set a value, or pass `undefined` to clear (removes the key). */
  onChange: (definitionId: string, value: PropertyValue | undefined) => void;
  /** Person's first/last name (leads), used to cross-check the RPPS practitioner card. */
  firstName?: string;
  lastName?: string;
}

/**
 * Dynamic inputs for a record's custom properties, one per active definition
 * of its entity type. The control, its validation message and its layout come
 * from the type registry (`lib/propertyTypes.tsx`); computed definitions are
 * engine-owned and never rendered.
 */
export function CustomPropertyFields({
  definitions,
  values,
  onChange,
  firstName,
  lastName,
}: Props) {
  const verifyRppsAction = useAuthAction(api.features.practitionerInfo.actions.verifyRpps);
  const verifyRpps = useCallback(
    (digits: string): Promise<RppsVerificationResult> =>
      verifyRppsAction({ value: digits }) as Promise<RppsVerificationResult>,
    [verifyRppsAction],
  );

  const editable = definitions.filter((def) => !def.computed);
  if (editable.length === 0) return null;

  return (
    <fieldset className="space-y-3 rounded-md border border-border p-3">
      <legend className="px-1 text-sm font-medium">Propriétés personnalisées</legend>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {editable.map((def) => {
          const id = `cp-${def._id}`;
          const value = values[def._id];
          const error = validatePropertyValue(def, value);
          const control = propertyTypeUi(def.type).renderInput({
            id,
            def,
            value,
            onChange: (v) => onChange(def._id, v),
            invalid: !!error,
            context: { firstName, lastName, verifyRpps },
          });
          if (def.type === 'boolean') {
            return (
              <div key={def._id} className="self-end pb-2">
                {control}
              </div>
            );
          }
          return (
            <div key={def._id} className="space-y-1">
              <Label htmlFor={id}>{def.label}</Label>
              {control}
              {error && def.type !== 'email' && <HelperText variant="error">{error}</HelperText>}
            </div>
          );
        })}
      </div>
    </fieldset>
  );
}
