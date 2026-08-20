import { useSyncExternalStore } from 'react';

const MOBILE_BREAKPOINT = '(max-width: 767px)';

function getSnapshot(): boolean {
  return window.matchMedia(MOBILE_BREAKPOINT).matches;
}

function getServerSnapshot(): boolean {
  return false;
}

function subscribe(callback: () => void): () => void {
  const mediaQuery = window.matchMedia(MOBILE_BREAKPOINT);
  mediaQuery.addEventListener('change', callback);
  return () => mediaQuery.removeEventListener('change', callback);
}

export function useIsMobile(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
