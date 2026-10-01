import { ConvexError, type Value } from 'convex/values';
import { refusalOf } from '../../_lib/refusal';

/** REST error shape; a ConvexError crosses the mutation → action boundary and rolls the write back. */
export type ApiErrorData = {
  status: number;
  code: string;
  message: string;
  details?: Value;
};

export function apiError(
  status: number,
  code: string,
  message: string,
  details?: Value,
): ConvexError<ApiErrorData> {
  return new ConvexError<ApiErrorData>({
    status,
    code,
    message,
    ...(details !== undefined ? { details } : {}),
  });
}

export function isApiError(error: unknown): error is ConvexError<ApiErrorData> {
  if (!(error instanceof ConvexError)) return false;
  const data = error.data as Partial<ApiErrorData> | undefined;
  return typeof data?.status === 'number' && typeof data.code === 'string';
}

/** Backend error codes that describe a state conflict rather than a bad input. */
const CONFLICT_CODES = new Set([
  'lifecycle_regression_blocked',
  'company_registration_exists',
  'company_vat_exists',
  'company_domain_exists',
  'deal_transition_forbidden',
  'stage_tag_required',
]);

/** Backend refusals (`code`, `code: reason`) → API errors (conflict codes 409, other codes 400); anything else passes as it is, an internal error. */
export function toApiError(error: unknown): unknown {
  if (isApiError(error)) return error;
  const known = refusalOf(error);
  if (!known) return error;
  const { code, reason } = known;
  return apiError(
    CONFLICT_CODES.has(code) ? 409 : 400,
    code,
    reason ? `${code}: ${reason}` : code,
    reason ? { reason } : undefined,
  );
}
