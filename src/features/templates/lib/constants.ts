import type { TemplateScope } from '@crm/lib/backend';
import type { StatusTone } from '@crm/design-system';

export const TEMPLATE_SCOPE_LABEL: Record<TemplateScope, string> = {
  private: 'Privé',
  team: 'Équipe',
  organization: 'Organisation',
};

export const TEMPLATE_SCOPE_TONE: Record<TemplateScope, StatusTone> = {
  private: 'gray',
  team: 'blue',
  organization: 'green',
};

export const TEMPLATE_SCOPE_HELP: Record<TemplateScope, string> = {
  private: 'Visible de vous seul.',
  team: 'Visible des membres de vos équipes.',
  organization: 'Visible de toute l’organisation.',
};
