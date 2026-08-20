function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export function formatDate(input: string | null | undefined): string | null {
  if (!input) return null;
  const fr = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(input);
  if (fr) return `${pad(+fr[1])}/${pad(+fr[2])}/${fr[3]}`;
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) return input;
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

export function formatDateTime(input: string | null | undefined): string | null {
  if (!input) return null;
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) return input;
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
