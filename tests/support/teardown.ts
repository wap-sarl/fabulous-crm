/** What the running test has to undo; the setup runs it when the test ends. */
const closers: (() => Promise<void>)[] = [];

export function onTestEnd(close: () => Promise<void>): void {
  closers.push(close);
}

export async function endTest(): Promise<void> {
  for (const close of closers.splice(0)) await close();
}
