/** The opt-out line of every SMS; Brevo substitutes its short code at send time. Added where a message leaves, so a workflow written before the rule carries it too; the editors pre-fill it so authors see it. */
export const SMS_STOP_LINE = 'STOP au [STOP_CODE]';

/** Whether a body already carries the line, wherever the author left it. */
export const SMS_STOP_RE = /STOP au \[STOP_CODE\]/;

export function withStopLine(body: string): string {
  if (SMS_STOP_RE.test(body)) return body;
  const trimmed = body.replace(/\s+$/, '');
  return trimmed ? `${trimmed}\n\n${SMS_STOP_LINE}` : SMS_STOP_LINE;
}
