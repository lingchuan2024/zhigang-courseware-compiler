interface NebulaViewportControlsProps {
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
}

export function NebulaViewportControls({ zoom, onZoomIn, onZoomOut, onFit }: NebulaViewportControlsProps) {
  return (
    <div className="absolute bottom-6 right-6 z-30 flex items-center gap-1.5 rounded-2xl border border-white/10 bg-[#050a12]/75 p-1.5 text-[#dcecf4] shadow-2xl backdrop-blur-xl">
      <button
        type="button"
        onClick={onZoomOut}
        aria-label="缩小星云"
        className="grid h-9 w-9 place-items-center rounded-xl text-lg transition hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#72d9e8]"
      >
        <span aria-hidden="true">−</span>
        <span className="sr-only">缩小</span>
      </button>
      <span className="min-w-12 text-center font-mono text-[11px] tracking-wider text-[#7890a3]" aria-live="polite">
        {Math.round(zoom * 100)}%
      </span>
      <button
        type="button"
        onClick={onZoomIn}
        aria-label="放大星云"
        className="grid h-9 w-9 place-items-center rounded-xl text-lg transition hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#72d9e8]"
      >
        <span aria-hidden="true">+</span>
        <span className="sr-only">放大</span>
      </button>
      <div className="mx-1 h-5 w-px bg-white/10" />
      <button
        type="button"
        onClick={onFit}
        aria-label="适应全部星云"
        className="rounded-xl px-3 py-2 text-xs tracking-wide text-[#a9c0cf] transition hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#72d9e8]"
      >
        适应全部星云
      </button>
    </div>
  );
}
