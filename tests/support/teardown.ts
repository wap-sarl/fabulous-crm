/** What the running test opened, closed by the setup when it ends. */
const closers: (() => Promise<void>)[] = [];

export function onTestEnd(close: () => Promise<void>): void {
  closers.push(close);
}

export async function closeBackends(): Promise<void> {
  for (const close of closers.splice(0)) await close();
}
