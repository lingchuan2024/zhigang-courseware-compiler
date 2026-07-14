import type { ReactNode } from 'react';

interface AppShellProps {
  children: ReactNode;
  onHome: () => void;
  action?: ReactNode;
}

export function AppShell({ children, onHome, action }: AppShellProps) {
  return (
    <div className="min-h-screen bg-space-950 text-space-text">
      <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-space-border bg-space-900/90 px-6 backdrop-blur-xl md:px-10">
        <button type="button" onClick={onHome} className="group flex items-baseline gap-3 text-left">
          <span className="font-song text-2xl font-bold tracking-[0.16em] text-ink">知纲</span>
          <span className="hidden font-mono text-[10px] tracking-[0.24em] text-space-muted sm:inline">KNOWLEDGE UNIVERSE</span>
        </button>
        {action}
      </header>
      {children}
    </div>
  );
}
