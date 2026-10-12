import type { FormFieldInput as FormField, Id } from '@crm/lib/backend';

export interface EditorDraft {
  name: string;
  fields: FormField[];
  buttonText: string;
  consentText: string;
  subscriptionTypeIds: Id<'subscriptionTypes'>[];
  afterKind: 'message' | 'redirect';
  afterMessage: string;
  afterUrl: string;
  active: boolean;
}
