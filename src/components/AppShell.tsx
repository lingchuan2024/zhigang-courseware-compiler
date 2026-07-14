import type { ReactNode } from 'react';

interface AppShellProps {
  children: ReactNode;
  onHome: () => void;
  action?: ReactNode;
}

export function AppShell({ children, onHome, action }: AppShellProps) {
  return (
    <div className="min-h-screen bg-[#f3eee4] text-charcoal">
      <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-[#dcd3c4] bg-[#f8f5ee]/95 px-6 backdrop-blur md:px-10">
        <button type="button" onClick={onHome} className="group flex items-baseline gap-3 text-left">
          <span className="font-song text-2xl font-bold tracking-[0.16em] text-ink">知纲</span>
          <span className="hidden text-xs tracking-[0.2em] text-stone-400 sm:inline">KNOWLEDGE WEAVER</span>
        </button>
        {action}
      </header>
      {children}
    </div>
  );
}
