import { Mail, MessageSquare } from 'lucide-react';
import type { CampaignChannel } from '@crm/lib/backend';

/** One place for the list and the detail views, so neither hardcodes e-mail; a missing channel reads as e-mail, the schema default. */
export function CampaignChannelBadge({ channel }: { channel?: CampaignChannel }) {
  const isSms = channel === 'sms';
  const Icon = isSms ? MessageSquare : Mail;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-[7px] bg-[#EFEBFE] px-2 py-[3px] text-xs font-semibold text-[#6A4BF0]">
      <Icon className="size-3.5" />
      {isSms ? 'SMS' : 'E-mail'}
    </span>
  );
}
