export type AtlasBackdropVariant = 'dormant' | 'library' | 'qa' | 'workspace' | 'reading';

/** Decorative cartography stays outside the reading surface. */
export function AtlasBackdrop({ variant }: { variant: AtlasBackdropVariant }) {
  return <div aria-hidden="true" data-atlas-backdrop={variant} className={`atlas-backdrop atlas-backdrop--${variant}`} />;
}
