import { cn } from '@crm/design-system';
import { Mail, MessageSquare, type LucideIcon } from 'lucide-react';
import type { CampaignChannel } from '@crm/lib/backend';

interface ChannelOption {
  value: CampaignChannel;
  label: string;
  description: string;
  icon: LucideIcon;
}

const OPTIONS: ChannelOption[] = [
  {
    value: 'email',
    label: 'E-mail',
    description: 'Cible les leads avec une adresse e-mail.',
    icon: Mail,
  },
  {
    value: 'sms',
    label: 'SMS',
    description: 'Cible les leads avec un numéro de téléphone.',
    icon: MessageSquare,
  },
];

interface Props {
  value: CampaignChannel;
  onChange: (channel: CampaignChannel) => void;
  /** SMS requires a configured Brevo account; the SMS card is disabled otherwise. */
  smsAvailable?: boolean;
}

/**
 * Large icon "radio" cards to pick the campaign channel. Selecting a channel is
 * what seeds the matching recipient filter (email/phone "is not empty") on the
 * create page. The SMS card is disabled when Brevo isn't configured (SMS is
 * Brevo-only).
 */
export function CampaignChannelSelector({ value, onChange, smsAvailable = true }: Props) {
  return (
    <div
      role="radiogroup"
      aria-label="Canal de la campagne"
      className="grid gap-3 sm:grid-cols-2"
    >
      {OPTIONS.map((option) => {
        const selected = option.value === value;
        const disabled = option.value === 'sms' && !smsAvailable;
        const Icon = option.icon;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-disabled={disabled}
            disabled={disabled}
            onClick={() => !disabled && onChange(option.value)}
            className={cn(
              'flex items-center gap-3 rounded-xl border bg-card p-4 text-left transition',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-soft',
              disabled
                ? 'cursor-not-allowed border-border opacity-60'
                : 'cursor-pointer',
              !disabled &&
                (selected
                  ? 'border-primary ring-2 ring-primary'
                  : 'border-border hover:border-primary/40')
            )}
          >
            <span
              className={cn(
                'flex size-10 shrink-0 items-center justify-center rounded-lg transition',
                selected && !disabled ? 'bg-primary text-white' : 'bg-muted text-faint'
              )}
            >
              <Icon className="size-5" aria-hidden="true" />
            </span>
            <span className="flex flex-col">
              <span className="text-sm font-semibold text-ink">{option.label}</span>
              <span className="text-xs text-faint">
                {disabled ? 'Nécessite un compte Brevo configuré.' : option.description}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
