export function isNotDeleted<T extends { deletedAt?: number }>(
  row: T | null | undefined,
): row is T {
  return row != null && row.deletedAt == null;
}
