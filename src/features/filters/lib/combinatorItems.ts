import type { FilterCombinator } from '@crm/lib/backend';

export const COMBINATOR_ITEMS: { value: FilterCombinator; label: string }[] = [
  { value: 'and', label: 'ET' },
  { value: 'or', label: 'OU' },
];
