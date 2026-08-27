import { KeyValueRow } from '@crm/design-system';
import type { PropertyValue } from '@crm/lib/backend';
import { formatPropertyValue, hasPropertyValue } from '../lib/customProperties';
import type { PropertyDefinitionRow } from '../types';

/** The set custom properties of a record, as rows of a detail page's KeyValueList. */
export function CustomPropertyRows({
  definitions,
  values,
}: {
  definitions: PropertyDefinitionRow[];
  values: Record<string, PropertyValue> | undefined;
}) {
  return (
    <>
      {definitions
        .filter((def) => hasPropertyValue(values?.[def._id]))
        .map((def) => (
          <KeyValueRow key={def._id} label={def.label}>
            {formatPropertyValue(def, values?.[def._id])}
          </KeyValueRow>
        ))}
    </>
  );
}
