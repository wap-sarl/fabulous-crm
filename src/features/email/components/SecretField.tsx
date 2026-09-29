import { Input, Label } from '@crm/design-system';

/** A masked, write-only secret input: shows "saved" placeholder, sends only if typed. */
export function SecretField({
  label,
  value,
  hasStored,
  onChange,
  hint,
}: {
  label: string;
  value: string;
  hasStored: boolean;
  onChange: (v: string) => void;
  hint?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Input
        type="password"
        autoComplete="off"
        value={value}
        placeholder={hasStored ? '•••••••••• (enregistré)' : 'Non configuré'}
        onChange={(e) => onChange(e.target.value)}
      />
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
