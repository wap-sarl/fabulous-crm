import { ConvexError } from 'convex/values';
import { extensions } from '../extensions';
import type { LoginMethods, Refusal } from './extensionTypes';

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

export const SIGN_IN_GENERIC_ERROR = 'Une erreur est survenue. Veuillez réessayer.';

/** A Better Auth sign-in error as a French message: the overlay's own codes first, then the core's. */
export function describeSignInError(err: { code?: string; message?: string } | null): string {
  // A refusal from the seam travels as the error's message, under Better Auth's own `code`.
  for (const code of [err?.message, err?.code]) {
    const described = code ? extensions.describeRefusal?.({ code, data: {} }) : null;
    if (described) return described;
  }
  const code = err?.code ?? err?.message ?? '';
  if (code === 'not_invited' || code === 'FORBIDDEN')
    return "Cette adresse n'est pas autorisée. Demandez une invitation à un administrateur.";
  if (code.includes('OTP') || code.includes('otp') || code === 'INVALID_OTP')
    return 'Code incorrect ou expiré. Veuillez réessayer.';
  return SIGN_IN_GENERIC_ERROR;
}

/** The login page's e-mail code form: the deployment's toggle, which an overlay can only narrow, and the overlay's notice. */
export function emailCodeForm(
  config: { auth: { magicLink: boolean } } | undefined,
  search: URLSearchParams,
): { shown: boolean; notice: string | null } {
  const own = config?.auth.magicLink ?? true;
  const decided: LoginMethods | null | undefined = config
    ? extensions.loginMethods?.(config as Record<string, unknown>, search)
    : null;
  // A method the deployment disabled stays disabled, whatever the overlay answers.
  const shown = own && decided?.emailCode !== false;
  return { shown, notice: shown ? (decided?.emailCodeNotice ?? null) : null };
}
