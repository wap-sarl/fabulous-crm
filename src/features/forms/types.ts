import type { FormFieldInput as FormField } from '@crm/lib/backend';

export interface EditorDraft {
  name: string;
  fields: FormField[];
  buttonText: string;
  consentText: string;
  afterKind: 'message' | 'redirect';
  afterMessage: string;
  afterUrl: string;
  active: boolean;
}
