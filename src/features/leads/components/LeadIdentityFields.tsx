import { EmailInput, HelperText, Input, Label, validateEmail } from '@crm/design-system';
import type { FieldErrors, FormState } from '../lib/leadForm';

interface LeadIdentityFieldsProps {
  form: FormState;
  setField: <K extends keyof FormState>(key: K, value: FormState[K]) => void;
  fieldErrors: FieldErrors;
}

export function LeadIdentityFields({ form, setField, fieldErrors }: LeadIdentityFieldsProps) {
  return (
    <>
      <div className="space-y-1">
        <Label htmlFor="firstName">Prénom *</Label>
        <Input
          id="firstName"
          value={form.firstName}
          onChange={(e) => setField('firstName', e.target.value)}
          invalid={!!fieldErrors.firstName}
          aria-invalid={!!fieldErrors.firstName}
          aria-describedby={fieldErrors.firstName ? 'firstName-error' : undefined}
        />
        {fieldErrors.firstName ? (
          <HelperText id="firstName-error" variant="error">
            {fieldErrors.firstName}
          </HelperText>
        ) : null}
      </div>
      <div className="space-y-1">
        <Label htmlFor="lastName">Nom *</Label>
        <Input
          id="lastName"
          value={form.lastName}
          onChange={(e) => setField('lastName', e.target.value)}
          invalid={!!fieldErrors.lastName}
          aria-invalid={!!fieldErrors.lastName}
          aria-describedby={fieldErrors.lastName ? 'lastName-error' : undefined}
        />
        {fieldErrors.lastName ? (
          <HelperText id="lastName-error" variant="error">
            {fieldErrors.lastName}
          </HelperText>
        ) : null}
      </div>

      <div className="space-y-1">
        <Label htmlFor="email">E-mail *</Label>
        <EmailInput
          id="email"
          value={form.email}
          onChange={(e) => setField('email', e.target.value)}
          error={fieldErrors.email ?? (form.email ? validateEmail(form.email) : null)}
          errorId="email-error"
        />
      </div>
    </>
  );
}
