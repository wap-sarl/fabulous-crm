import { Mail, MessageSquare } from 'lucide-react';
import type { CampaignChannel } from '@crm/lib/backend';

/**
 * Read-only chip showing a campaign's channel. Kept in one place so the list and
 * detail views can't drift back to an email-only hardcode. Absent channel (legacy
 * rows) reads as e-mail, matching the schema default.
 */
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
