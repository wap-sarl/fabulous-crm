import { useSyncExternalStore } from 'react';

const TOUCH_QUERY = '(pointer: coarse)';

function getSnapshot(): boolean {
  return window.matchMedia(TOUCH_QUERY).matches;
}

function getServerSnapshot(): boolean {
  return false;
}

function subscribe(callback: () => void): () => void {
  const mediaQuery = window.matchMedia(TOUCH_QUERY);
  mediaQuery.addEventListener('change', callback);
  return () => mediaQuery.removeEventListener('change', callback);
}

export function useIsTouchDevice(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
