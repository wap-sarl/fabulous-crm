import type { ImportEntity } from '../../../_lib/validators/imports';
import { activityImporter } from './activities';
import { companyImporter } from './companies';
import { dealImporter } from './deals';
import { leadImporter } from './leads';
import type { EntityImporter } from './types';

/** The importer of each entity; rows are typed by the job's entity when they are read. */
// biome-ignore lint/suspicious/noExplicitAny: one map over four row shapes; the job's entity picks the right one.
export const IMPORTERS: Record<ImportEntity, EntityImporter<any, any, any>> = {
  lead: leadImporter,
  company: companyImporter,
  deal: dealImporter,
  activity: activityImporter,
};

export type { EntityImporter, ImportActor, ImportApplied, ImportVerdict } from './types';
