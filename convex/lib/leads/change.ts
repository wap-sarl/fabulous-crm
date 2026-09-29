import type { Doc, Id } from '../../_generated/dataModel';

/** The change shape the Triggers wrapper hands to a `leads` trigger. */
export interface LeadChange {
  operation: 'insert' | 'update' | 'delete';
  id: Id<'leads'>;
  oldDoc: Doc<'leads'> | null;
  newDoc: Doc<'leads'> | null;
}
