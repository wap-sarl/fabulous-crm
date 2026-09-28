/** No test leaves the machine: a request nobody mocked is refused, and the test that sent it fails. */
const refused: string[] = [];

const addressOf = (input: string | URL | Request): string =>
  typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

export const refuseNetwork = (async (input: string | URL | Request, init?: RequestInit) => {
  refused.push(`${init?.method ?? 'GET'} ${addressOf(input)}`);
  throw new TypeError('network refused in tests: mock the request');
}) as unknown as typeof fetch;

/** The requests refused since the last call. */
export const takeRefused = (): string[] => refused.splice(0);
