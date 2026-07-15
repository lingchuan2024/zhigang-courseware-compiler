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
    imageClassName: 'object-[54%_58%] opacity-[0.42] saturate-[0.92] brightness-[0.9] md:opacity-[0.5]',
    washClassName: 'bg-[linear-gradient(112deg,rgba(1,2,7,.86)_0%,rgba(2,5,12,.42)_52%,rgba(1,2,7,.28)_100%)]',
  },
  library: {
    src: tarantulaLibrary,
    imageClassName: 'object-[58%_42%] opacity-[0.34] saturate-[0.92] brightness-[0.82] md:opacity-[0.42]',
    washClassName: 'bg-[linear-gradient(110deg,rgba(2,4,10,.8)_0%,rgba(3,7,15,.48)_56%,rgba(2,4,10,.74)_100%)]',
  },
  qa: {
    src: tarantulaQa,
    imageClassName: 'object-[52%_42%] opacity-[0.32] saturate-[0.9] brightness-[0.8] md:opacity-[0.4]',
    washClassName: 'bg-[linear-gradient(105deg,rgba(2,4,10,.83)_0%,rgba(5,6,18,.5)_58%,rgba(2,4,10,.78)_100%)]',
  },
  workspace: {
    src: cosmicCliffsWorkspace,
    imageClassName: 'object-[58%_45%] opacity-[0.3] saturate-[0.84] brightness-[0.76] md:opacity-[0.38]',
    washClassName: 'bg-[linear-gradient(108deg,rgba(2,4,10,.84)_0%,rgba(3,7,14,.54)_55%,rgba(2,4,10,.8)_100%)]',
  },
  reading: {
    src: southernRingReading,
    imageClassName: 'object-center opacity-[0.24] saturate-[0.78] brightness-[0.72] md:opacity-[0.32]',
    washClassName: 'bg-[radial-gradient(circle_at_55%_44%,rgba(3,7,14,.5)_0%,rgba(2,4,10,.75)_66%,rgba(1,2,7,.91)_100%)]',
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
