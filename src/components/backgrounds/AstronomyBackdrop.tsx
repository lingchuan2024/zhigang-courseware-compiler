import { useState } from 'react';
import cosmicCliffsWorkspace from '../../assets/astronomy/cosmic-cliffs-workspace.webp';
import horseheadDormant from '../../assets/astronomy/horsehead-dormant.webp';
import southernRingReading from '../../assets/astronomy/southern-ring-reading.webp';
import tarantulaLibrary from '../../assets/astronomy/tarantula-library.webp';
import tarantulaQa from '../../assets/astronomy/tarantula-qa.webp';

export type AstronomyBackdropVariant = 'dormant' | 'library' | 'qa' | 'workspace' | 'reading';

interface BackdropDefinition {
  src: string;
  imageClassName: string;
  washClassName: string;
}

const BACKDROPS: Record<AstronomyBackdropVariant, BackdropDefinition> = {
  dormant: {
    src: horseheadDormant,
    imageClassName: 'object-[54%_46%] opacity-[0.18] saturate-[0.62] brightness-[0.68] md:opacity-[0.22]',
    washClassName: 'bg-[linear-gradient(112deg,rgba(1,2,7,.88)_0%,rgba(2,5,12,.66)_52%,rgba(1,2,7,.91)_100%)]',
  },
  library: {
    src: tarantulaLibrary,
    imageClassName: 'object-[58%_42%] opacity-[0.18] saturate-[0.82] brightness-[0.68] md:opacity-[0.22]',
    washClassName: 'bg-[linear-gradient(110deg,rgba(2,4,10,.91)_0%,rgba(3,7,15,.64)_56%,rgba(2,4,10,.88)_100%)]',
  },
  qa: {
    src: tarantulaQa,
    imageClassName: 'object-[52%_42%] opacity-[0.15] saturate-[0.8] brightness-[0.64] md:opacity-[0.19]',
    washClassName: 'bg-[linear-gradient(105deg,rgba(2,4,10,.93)_0%,rgba(5,6,18,.68)_58%,rgba(2,4,10,.9)_100%)]',
  },
  workspace: {
    src: cosmicCliffsWorkspace,
    imageClassName: 'object-[58%_45%] opacity-[0.14] saturate-[0.72] brightness-[0.62] md:opacity-[0.18]',
    washClassName: 'bg-[linear-gradient(108deg,rgba(2,4,10,.92)_0%,rgba(3,7,14,.68)_55%,rgba(2,4,10,.9)_100%)]',
  },
  reading: {
    src: southernRingReading,
    imageClassName: 'object-center opacity-[0.1] saturate-[0.66] brightness-[0.58] md:opacity-[0.13]',
    washClassName: 'bg-[radial-gradient(circle_at_55%_44%,rgba(3,7,14,.7)_0%,rgba(2,4,10,.9)_66%,rgba(1,2,7,.97)_100%)]',
  },
};

interface AstronomyBackdropProps {
  variant: AstronomyBackdropVariant;
}

export function AstronomyBackdrop({ variant }: AstronomyBackdropProps) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const backdrop = BACKDROPS[variant];
  const failed = failedSrc === backdrop.src;

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 overflow-hidden bg-[#02040a]"
      data-astronomy-backdrop={variant}
      data-astronomy-status={failed ? 'fallback' : 'ready'}
    >
      {!failed && (
        <img
          alt=""
          className={`absolute inset-0 h-full w-full object-cover ${backdrop.imageClassName}`}
          decoding="async"
          onError={() => setFailedSrc(backdrop.src)}
          src={backdrop.src}
        />
      )}
      <div className={`absolute inset-0 ${backdrop.washClassName}`} />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_0%,rgba(0,2,7,.2)_58%,rgba(0,1,5,.68)_100%)]" />
    </div>
  );
}
