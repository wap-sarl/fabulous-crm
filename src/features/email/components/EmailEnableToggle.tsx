import { Switch } from '@crm/design-system';

/** The two providers are mutually exclusive: the email `provider` is a single value, so turning one on turns the other off. */
export function EmailEnableToggle({
  label,
  checked,
  onEnable,
}: {
  label: string;
  checked: boolean;
  onEnable: () => void;
}) {
  return (
    <div className="flex items-center gap-3">
      <Switch
        checked={checked}
        // Only enabling changes the provider; you disable by enabling the other.
        onCheckedChange={(v) => v && onEnable()}
        aria-label={label}
      />
      <span className="text-sm font-medium text-ink">{label}</span>
    </div>
  );
}
