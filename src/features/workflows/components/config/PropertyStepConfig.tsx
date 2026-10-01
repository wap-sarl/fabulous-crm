import { useMemo } from 'react';
import {
  Combobox,
  HelperText,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@crm/design-system';
import type {
  Id,
  PropertyValue,
  TrackedLinkStandardField,
  WorkflowLeadTarget,
  WorkflowNode,
} from '@crm/lib/backend';
import { propertyTypeUi } from '../../../properties/lib/propertyTypes';
import type { PropertyDefinitionRow } from '../../../properties/types';

type PropertyNode = Extract<WorkflowNode, { type: 'update_property' }>;

/** Built-in fields a workflow may write (same exclusions as tracked links). */
const WRITABLE_STANDARD_FIELDS: { field: TrackedLinkStandardField; label: string }[] = [
  { field: 'firstName', label: 'Prénom' },
  { field: 'lastName', label: 'Nom' },
  { field: 'email', label: 'E-mail' },
  { field: 'phone', label: 'Téléphone' },
  { field: 'comment', label: 'Commentaire' },
  { field: 'isRedFlagged', label: 'Signalé' },
];

const encodeTarget = (t: WorkflowLeadTarget) =>
  t.kind === 'standard' ? `std:${t.field}` : `cp:${t.propertyDefId}`;

interface PropertyStepConfigProps {
  value: PropertyNode;
  onChange: (next: PropertyNode) => void;
  definitions: PropertyDefinitionRow[];
}

export function PropertyStepConfig({ value, onChange, definitions }: PropertyStepConfigProps) {
  const items = useMemo(
    () => [
      ...WRITABLE_STANDARD_FIELDS.map((f) => ({ value: `std:${f.field}`, label: f.label })),
      ...definitions.map((d) => ({ value: `cp:${d._id}`, label: d.label })),
    ],
    [definitions],
  );

  const handleTargetChange = (key: string) => {
    const target: WorkflowLeadTarget = key.startsWith('cp:')
      ? { kind: 'custom', propertyDefId: key.slice(3) as Id<'propertyDefinitions'> }
      : { kind: 'standard', field: key.slice(4) as TrackedLinkStandardField };
    // Reset the value to a type-appropriate default when the target changes.
    const defaultValue: PropertyValue =
      target.kind === 'standard' && target.field === 'isRedFlagged' ? true : '';
    onChange({ ...value, target, value: defaultValue });
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="space-y-1.5">
        <Label>Propriété à modifier</Label>
        <Combobox
          items={items}
          value={encodeTarget(value.target)}
          onValueChange={handleTargetChange}
          placeholder="Propriété"
          modal
          className="w-full"
        />
      </div>
      <div className="space-y-1.5">
        <Label>Nouvelle valeur</Label>
        <PropertyValueInput
          target={value.target}
          value={value.value}
          definitions={definitions}
          onChange={(v) => onChange({ ...value, value: v })}
        />
      </div>
    </div>
  );
}

function PropertyValueInput({
  target,
  value,
  definitions,
  onChange,
}: {
  target: WorkflowLeadTarget;
  value: PropertyValue;
  definitions: PropertyDefinitionRow[];
  onChange: (v: PropertyValue) => void;
}) {
  const def =
    target.kind === 'custom' ? definitions.find((d) => d._id === target.propertyDefId) : undefined;

  const booleanSelect = (
    <Select value={value === true ? 'oui' : 'non'} onValueChange={(v) => onChange(v === 'oui')}>
      <SelectTrigger className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="oui">Oui</SelectItem>
        <SelectItem value="non">Non</SelectItem>
      </SelectContent>
    </Select>
  );

  if (target.kind === 'standard') {
    if (target.field === 'isRedFlagged') return booleanSelect;
    return (
      <Input
        value={typeof value === 'string' ? value : ''}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }

  if (!def) return <HelperText>Propriété introuvable ou supprimée.</HelperText>;

  return propertyTypeUi(def.type).renderInput({
    id: 'wf-property-value',
    def,
    value,
    onChange: (v) => onChange(v ?? ''),
  });
}
