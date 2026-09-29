import { formFieldKey } from '@crm/lib/backend';
import type { FormFieldInput as FormField } from '@crm/lib/backend';
import { Button, Input, Textarea } from '@crm/design-system';
import type { PropertyDefinitionRow } from '../../properties/types';
import type { EditorDraft } from '../types';

/** Static rendering of the form as visitors will see it. */
export function FormPreview({
  draft,
  defsById,
}: {
  draft: EditorDraft;
  defsById: Map<string, PropertyDefinitionRow>;
}) {
  const input = (field: FormField) => {
    const type =
      field.target.kind === 'custom'
        ? (defsById.get(field.target.propertyDefId)?.type ?? 'text')
        : null;
    const options =
      field.target.kind === 'custom'
        ? (defsById.get(field.target.propertyDefId)?.options ?? [])
        : [];
    if (field.target.kind === 'standard' && field.target.field === 'comment') {
      return <Textarea disabled rows={3} className="bg-white" />;
    }
    if (type === 'select') {
      return (
        <select
          disabled
          className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm"
        >
          <option />
          {options.map((o) => (
            <option key={o.value}>{o.label}</option>
          ))}
        </select>
      );
    }
    if (type === 'radio' || type === 'checkbox') {
      return (
        <div className="flex flex-col gap-1">
          {options.map((o) => (
            <label key={o.value} className="flex items-center gap-2 text-sm text-body">
              <input type={type === 'radio' ? 'radio' : 'checkbox'} disabled />
              {o.label}
            </label>
          ))}
        </div>
      );
    }
    if (type === 'boolean') {
      return (
        <label className="flex items-center gap-2 text-sm text-body">
          <input type="checkbox" disabled />
          {field.label}
        </label>
      );
    }
    return (
      <Input
        disabled
        type={type === 'number' ? 'number' : type === 'date' ? 'date' : 'text'}
        className="bg-white"
      />
    );
  };

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-[#FAFAFB] p-4">
      {draft.fields.map((field) => (
        <div key={formFieldKey(field.target)} className="flex flex-col gap-1">
          <span className="text-[13px] font-semibold text-ink">
            {field.label || '(sans libellé)'}
            {field.required ? ' *' : ''}
          </span>
          {input(field)}
        </div>
      ))}
      <label className="flex items-start gap-2 text-xs text-soft">
        <input type="checkbox" disabled className="mt-0.5" />
        {draft.consentText}
      </label>
      <Button disabled className="self-start">
        {draft.buttonText || 'Envoyer'}
      </Button>
    </div>
  );
}
