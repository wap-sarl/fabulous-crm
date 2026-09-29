import { ConvexError, type Value } from 'convex/values';

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

const CODE_RE = /^[a-z][a-z0-9_]*$/;

/** Backend `code[: reason]` errors → API errors (conflict codes 409, other codes 400, else internal). */
export function toApiError(error: unknown): unknown {
  if (isApiError(error)) return error;
  if (!(error instanceof Error)) return error;
  const [code, ...rest] = error.message.split(': ');
  if (!CODE_RE.test(code)) return error;
  const reason = rest.join(': ');
  return apiError(
    CONFLICT_CODES.has(code) ? 409 : 400,
    code,
    reason ? `${code}: ${reason}` : code,
    reason ? { reason } : undefined,
  );
}
