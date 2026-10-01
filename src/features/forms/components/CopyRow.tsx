import { Button, toast } from '@crm/design-system';

export function CopyRow({ label, value }: { label: string; value: string }) {
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success('Copié.');
    } catch {
      toast.error('Impossible de copier.');
    }
  };
  return (
    <div className="space-y-1">
      <span className="text-xs font-semibold text-soft">{label}</span>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-md bg-muted px-2 py-1.5 font-mono text-xs text-body">
          {value}
        </code>
        <Button variant="outline" size="sm" onClick={copy}>
          Copier
        </Button>
      </div>
    </div>
  );
}
