import { ConvexError } from 'convex/values';
import { extensions } from '../extensions';
import type { Refusal } from './extensionTypes';

/** The refusal behind an error, a code string, or a ConvexError with `{ code, ...data }`; null for anything else. */
export function refusalOf(error: unknown): Refusal | null {
  if (typeof error === 'string') return error ? { code: error, data: {} } : null;
  if (error instanceof ConvexError) {
    const data: unknown = error.data;
    if (data && typeof data === 'object' && typeof (data as { code?: unknown }).code === 'string') {
      return { code: (data as { code: string }).code, data: data as Record<string, unknown> };
    }
    return typeof data === 'string' ? { code: data, data: {} } : null;
  }
  if (error instanceof Error) return error.message ? { code: error.message, data: {} } : null;
  return null;
}

/** The overlay's message for a refusal it owns, else `fallback`. Generic error toasts go through here. */
export function describeError(error: unknown, fallback: string): string {
  const refusal = refusalOf(error);
  return (refusal && extensions.describeRefusal?.(refusal)) || fallback;
}
