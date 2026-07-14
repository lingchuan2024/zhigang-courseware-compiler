import type { ReactNode } from 'react';
import {
  AstronomyBackdrop,
  type AstronomyBackdropVariant,
} from './backgrounds/AstronomyBackdrop';

interface AppShellProps {
  children: ReactNode;
  onHome: () => void;
  action?: ReactNode;
  backdrop?: AstronomyBackdropVariant;
}

export function AppShell({ children, onHome, action, backdrop }: AppShellProps) {
  return (
    <div className="relative min-h-screen bg-space-950 text-space-text">
      {backdrop && <AstronomyBackdrop variant={backdrop} />}
      <div data-app-shell-foreground className="relative z-10">
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-space-border bg-space-900/90 px-6 backdrop-blur-xl md:px-10">
          <button type="button" onClick={onHome} className="group flex items-baseline gap-3 text-left">
            <span className="font-song text-2xl font-bold tracking-[0.16em] text-ink">知纲</span>
            <span className="hidden font-mono text-[10px] tracking-[0.24em] text-space-muted sm:inline">KNOWLEDGE UNIVERSE</span>
          </button>
          {action}
        </header>
        <div data-app-shell-content>
          {children}
        </div>
      </div>
    </div>
  );
}
