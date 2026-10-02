import { doc } from 'convex-helpers/validators';
import type { TableNames } from '../../_generated/dataModel';
import schema from '../../schema';

/** The validator of a stored row, its system fields included: what a function that returns one declares. */
export const docOf = <T extends TableNames>(table: T) => doc(schema, table);
