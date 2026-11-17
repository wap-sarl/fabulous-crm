import { type ComponentType, lazy } from 'react';

/** A page is loaded when its route is first opened: the first screen carries the shell and nothing of the pages it does not show. */
export const page = <Name extends string>(
  load: () => Promise<Record<Name, ComponentType>>,
  name: Name,
) => lazy(() => load().then((module) => ({ default: module[name] })));
