const KEY = 'crm:reloaded-from-build';

/** Whether a page whose file is gone should load the new build: once per build it was opened on, so that every deployment gets its reload and a file really missing does not loop. */
export function shouldReloadForBuild(
  storage: Pick<Storage, 'getItem' | 'setItem'>,
  build: string,
): boolean {
  try {
    if (storage.getItem(KEY) === build) return false;
    storage.setItem(KEY, build);
    return true;
  } catch {
    // Without a storage to remember the reload in, there is none: it could loop.
    return false;
  }
}
