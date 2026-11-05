import type { QueryCtx } from '../../_generated/server';
import type { NotificationRecord } from '../../_lib/validators/notifications';
import { scopedReader, type Visibility } from '../roles/visibility';

/** Whether a person can open the record: read through their own scoped reader, the rules the record's page applies. Asked when the inbox row is written, and again when a delivery leaves. */
export async function canOpenRecord(
  ctx: QueryCtx,
  visibility: Visibility,
  record: NotificationRecord,
): Promise<boolean> {
  const id = ctx.db.normalizeId(record.table, record.id);
  if (!id) return false;
  return (await scopedReader(ctx, visibility).get(id)) !== null;
}
