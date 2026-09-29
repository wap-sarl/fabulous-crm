import type * as React from 'react';

function normalize(s: string | null | undefined): string {
  return (s ?? '').trim().toLowerCase();
}

export function matches(a: string | null | undefined, b: string | null | undefined): boolean {
  return normalize(a) === normalize(b);
}

export function MatchChip({ ok, formValue }: { ok: boolean; formValue?: string }) {
  if (ok) {
    return (
      <span className="inline-flex items-center rounded-md bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary">
        ✓ correspond
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-warning/10 px-1.5 py-0.5 text-xs font-medium text-warning">
      ≠ saisie&nbsp;: {formValue ? <code className="font-mono">{formValue}</code> : <em>(vide)</em>}
    </span>
  );
}

export function Row({
  label,
  apiValue,
  chip,
}: {
  label: string;
  apiValue: React.ReactNode;
  chip?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
      <span className="min-w-32 text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className="font-medium">
        {apiValue || <em className="text-muted-foreground">—</em>}
      </span>
      {chip}
    </div>
  );
}
