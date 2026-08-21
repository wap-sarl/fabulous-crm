export function isNotDeleted<T extends { deletedAt?: number }>(
  row: T | null | undefined,
): row is T {
  return row != null && row.deletedAt == null;
}

export function asActive<T extends { deletedAt?: number }>(row: T | null | undefined): T | null {
  return isNotDeleted(row) ? row : null;
}
