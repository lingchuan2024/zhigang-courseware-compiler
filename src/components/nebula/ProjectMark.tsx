interface ProjectMarkProps {
  subtitle?: string;
}

export function ProjectMark({ subtitle = 'KNOWLEDGE UNIVERSE' }: ProjectMarkProps) {
  return (
    <div className="pointer-events-none absolute left-6 top-6 z-30 md:left-10 md:top-8">
      <div className="font-song text-4xl font-bold tracking-[0.16em] text-[#f1f8fb] drop-shadow-[0_0_24px_rgba(112,216,235,.18)] md:text-5xl">
        知纲
      </div>
      {subtitle ? (
        <div className="mt-2 font-mono text-[9px] tracking-[0.36em] text-[#587185] md:text-[10px]">{subtitle}</div>
      ) : null}
    </div>
  );
}
