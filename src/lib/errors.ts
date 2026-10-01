import { ConvexError } from 'convex/values';
import { extensions } from '../extensions';
import type { LoginMethods, Refusal } from './extensionTypes';

/** The refusal behind an error, a code string, or a ConvexError with `{ code, ...data }`; null for anything else. */
function refusalOf(error: unknown): Refusal | null {
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

/** What an error says, to look a code up in: the `code` or `code: reason` of a refusal, the only text that reaches production; else its message. */
export function errorText(error: unknown): string {
  if (error instanceof ConvexError) {
    const refusal = refusalOf(error);
    if (refusal) {
      const { reason } = refusal.data;
      return typeof reason === 'string' ? `${refusal.code}: ${reason}` : refusal.code;
    }
  }
  return error instanceof Error ? error.message : String(error);
}

/** The sentence a refusal brings with it, when the backend wrote one. */
function refusalMessage(error: unknown): string | null {
  const message = refusalOf(error)?.data.message;
  return typeof message === 'string' && message ? message : null;
}

/** The code of `labels` an error carries, the longest first so that a code never hides one it is part of. */
export function errorCode(error: unknown, labels: Record<string, string>): string | undefined {
  const message = errorText(error);
  return Object.keys(labels)
    .sort((a, b) => b.length - a.length)
    .find((code) => message.includes(code));
}

/** The sentence for the code an error carries, else the one the refusal brings, else `fallback`. */
export function errorLabel(
  error: unknown,
  labels: Record<string, string>,
  fallback: string,
): string {
  const code = errorCode(error, labels);
  return code ? labels[code] : (refusalMessage(error) ?? fallback);
}

/** The overlay's message for a refusal it owns, else the one the refusal brings, else `fallback`. Generic error toasts go through here. */
export function describeError(error: unknown, fallback: string): string {
  const refusal = refusalOf(error);
  return (refusal && extensions.describeRefusal?.(refusal)) || refusalMessage(error) || fallback;
}

export const SIGN_IN_GENERIC_ERROR = 'Une erreur est survenue. Veuillez réessayer.';

/** A Better Auth sign-in error as a French message: the overlay's own codes first (it sees Better Auth's messages too), then the core's. */
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
  // An overlay decides from the config: until it arrives nothing is shown, rather than a form that may vanish.
  if (!config) return { shown: !extensions.loginMethods, notice: null };
  const decided: LoginMethods | null =
    extensions.loginMethods?.(config as Record<string, unknown>, search) ?? null;
  // A method the deployment disabled stays disabled, whatever the overlay answers.
  const shown = config.auth.magicLink && decided?.emailCode !== false;
  return { shown, notice: shown ? (decided?.emailCodeNotice ?? null) : null };
}
