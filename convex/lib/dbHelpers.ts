export function filterUndefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>;
}

export function isNotDeleted<T extends { deletedAt?: number | null }>(doc: T): boolean {
  return !doc.deletedAt;
}

export function sortByOrder<T extends { order?: number | null }>(a: T, b: T): number {
  return (a.order ?? Infinity) - (b.order ?? Infinity);
}
