const keys = new WeakMap<object, number>();
let next = 0;

/** A rule and a group have no id of their own: each object gets a key when first seen, so that removing one from the middle of a list leaves the others their inputs (an open menu, a date half typed). */
export function keyOf(item: object): number {
  let key = keys.get(item);
  if (key === undefined) {
    key = next++;
    keys.set(item, key);
  }
  return key;
}

/** An edit replaces the object: the new one takes the key of the one it replaces, and its inputs stay mounted. */
export function inheritKey<T extends object>(from: object, to: T): T {
  keys.set(to, keyOf(from));
  return to;
}
