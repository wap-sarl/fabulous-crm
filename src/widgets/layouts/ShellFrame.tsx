import type { ReactNode } from 'react';

/** The column of the viewport's height that holds the shell and whatever a shell guard renders around it: each direct child takes its own height, the layout fills what is left. `DashboardShell` composes with it, the stories render through it, so they see what the shell sees. */
export function ShellFrame({ children }: { children: ReactNode }) {
  return <div className="flex h-viewport flex-col">{children}</div>;
}
