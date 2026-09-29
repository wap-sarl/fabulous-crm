import { slugOf } from './backend';

/** The key of a new entry, from its label: at most 24 characters, numbered until no entry has it. */
export function keyFromLabel(label: string, taken: Set<string>, fallback: string): string {
  const base = slugOf(label, '_').slice(0, 24) || fallback;
  let key = base;
  for (let i = 2; taken.has(key); i++) key = `${base}_${i}`;
  return key;
}
