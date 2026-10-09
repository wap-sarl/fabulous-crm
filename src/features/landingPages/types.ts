import type { LandingSection, LandingSeo } from '@crm/lib/backend';

/** What the editor holds and sends. */
export interface PageDraft {
  name: string;
  slug: string;
  seo: LandingSeo;
  sections: LandingSection[];
}
