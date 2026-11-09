import { useId, useState } from 'react';
import { cn } from '../../theme/utils';
import { Button } from './button';
import { HelperText } from './helper-text';
import { Input } from './input';
import { Label } from './label';

interface SecretFieldProps {
  label: string;
  placeholder?: string;
  /** Whether a value is kept; the value itself never comes back. */
  set: boolean;
  /** The part of the kept value that may be shown, a host for an address. */
  hint?: string;
  /** What is wrong with what was typed, or null. */
  validate?: (value: string) => string | null;
  /** Keeps the value; a rejection leaves the field open with what was typed. */
  onSave: (value: string) => Promise<unknown> | unknown;
  /** Takes the kept value back; absent, it can only be replaced. */
  onRemove?: () => Promise<unknown> | unknown;
  className?: string;
}

/** A value given once and never shown again: empty, it is a field with its button; kept, it says « Configuré » with the part that may be shown, and can be replaced or taken back. */
function SecretField({
  label,
  placeholder,
  set,
  hint,
  validate,
  onSave,
  onRemove,
  className,
}: SecretFieldProps) {
  const id = useId();
  const [replacing, setReplacing] = useState(false);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const close = () => {
    setReplacing(false);
    setValue('');
    setError(null);
  };
  const run = async (work: () => Promise<unknown> | unknown) => {
    setBusy(true);
    try {
      await work();
      close();
    } catch {
      // The caller says why; what was typed stays.
    } finally {
      setBusy(false);
    }
  };
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const typed = value.trim();
    const problem = typed ? (validate?.(typed) ?? null) : 'Ce champ est vide.';
    setError(problem);
    if (!problem) void run(() => onSave(typed));
  };

  if (set && !replacing) {
    return (
      <div
        data-slot="secret-field"
        className={cn('flex flex-wrap items-center justify-between gap-2', className)}
      >
        <p className="text-[13px] text-soft">
          <span className="font-medium text-ink">Configuré</span>
          {hint && <span> · {hint}</span>}
        </p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setReplacing(true)} disabled={busy}>
            Modifier
          </Button>
          {onRemove && (
            <Button variant="ghost" size="sm" onClick={() => void run(onRemove)} disabled={busy}>
              Retirer
            </Button>
          )}
        </div>
      </div>
    );
  }
  return (
    <form
      data-slot="secret-field"
      className={cn('space-y-1.5', className)}
      onSubmit={submit}
      noValidate
    >
      <Label htmlFor={id}>{label}</Label>
      <div className="flex flex-wrap gap-2">
        <Input
          id={id}
          className="min-w-0 flex-1"
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            setError(null);
          }}
          placeholder={placeholder}
          invalid={error !== null}
          aria-invalid={error !== null}
          aria-describedby={error ? `${id}-error` : undefined}
          autoComplete="off"
          spellCheck={false}
          disabled={busy}
        />
        <Button type="submit" disabled={busy}>
          Enregistrer
        </Button>
        {set && (
          <Button type="button" variant="ghost" onClick={close} disabled={busy}>
            Annuler
          </Button>
        )}
      </div>
      {error && (
        <HelperText id={`${id}-error`} variant="error">
          {error}
        </HelperText>
      )}
    </form>
  );
}

export { SecretField };
