import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  AstronomyBackdrop,
  type AstronomyBackdropVariant,
} from '../AstronomyBackdrop';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const BASE_BACKGROUND_CLASS_NAME = 'pointer-events-none absolute inset-0 overflow-hidden bg-[#02040a]';
const IMAGE_BASE_CLASS_NAME = 'absolute inset-0 h-full w-full object-cover';
const LAYER_BASE_CLASS_NAME = 'absolute inset-0';
const VIGNETTE_CLASS_NAME = 'absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_0%,rgba(0,2,7,.2)_58%,rgba(0,1,5,.68)_100%)]';
const QA_WASH_CLASS_NAME = 'bg-[linear-gradient(105deg,rgba(2,4,10,.83)_0%,rgba(5,6,18,.5)_58%,rgba(2,4,10,.78)_100%)]';

interface BackdropExpectation {
  variant: AstronomyBackdropVariant;
  filename: string;
  imageClassName: string;
  washClassName: string;
}

const backdrops: BackdropExpectation[] = [
  {
    variant: 'dormant',
    filename: 'horsehead-dormant',
    imageClassName: 'object-[54%_58%] opacity-[0.42] saturate-[0.92] brightness-[0.9] md:opacity-[0.5]',
    washClassName: 'bg-[linear-gradient(112deg,rgba(1,2,7,.86)_0%,rgba(2,5,12,.42)_52%,rgba(1,2,7,.28)_100%)]',
  },
  {
    variant: 'library',
    filename: 'tarantula-library',
    imageClassName: 'object-[58%_42%] opacity-[0.34] saturate-[0.92] brightness-[0.82] md:opacity-[0.42]',
    washClassName: 'bg-[linear-gradient(110deg,rgba(2,4,10,.8)_0%,rgba(3,7,15,.48)_56%,rgba(2,4,10,.74)_100%)]',
  },
  {
    variant: 'qa',
    filename: 'tarantula-qa',
    imageClassName: 'object-[52%_42%] opacity-[0.32] saturate-[0.9] brightness-[0.8] md:opacity-[0.4]',
    washClassName: QA_WASH_CLASS_NAME,
  },
  {
    variant: 'workspace',
    filename: 'cosmic-cliffs-workspace',
    imageClassName: 'object-[58%_45%] opacity-[0.3] saturate-[0.84] brightness-[0.76] md:opacity-[0.38]',
    washClassName: 'bg-[linear-gradient(108deg,rgba(2,4,10,.84)_0%,rgba(3,7,14,.54)_55%,rgba(2,4,10,.8)_100%)]',
  },
  {
    variant: 'reading',
    filename: 'southern-ring-reading',
    imageClassName: 'object-center opacity-[0.24] saturate-[0.78] brightness-[0.72] md:opacity-[0.32]',
    washClassName: 'bg-[radial-gradient(circle_at_55%_44%,rgba(3,7,14,.5)_0%,rgba(2,4,10,.75)_66%,rgba(1,2,7,.91)_100%)]',
  },
];

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('AstronomyBackdrop', () => {
  it.each(backdrops)('renders the calibrated decorative $variant image', ({
    variant,
    filename,
    imageClassName,
    washClassName,
  }) => {
    act(() => root.render(createElement(AstronomyBackdrop, { variant })));

    const backdrop = container.querySelector<HTMLElement>(`[data-astronomy-backdrop="${variant}"]`);
    const image = backdrop?.querySelector('img');
    const layerClassNames = Array.from(backdrop?.children ?? [], child => child.className);

    expect(backdrop).not.toBeNull();
    expect(image?.src).toContain(filename);
    expect(image?.alt).toBe('');
    expect(image?.getAttribute('decoding')).toBe('async');
    expect(image?.className).toBe(`${IMAGE_BASE_CLASS_NAME} ${imageClassName}`);
    expect(layerClassNames).toContain(`${LAYER_BASE_CLASS_NAME} ${washClassName}`);
    expect(backdrop?.getAttribute('aria-hidden')).toBe('true');
    expect(backdrop?.className).toContain('pointer-events-none');
  });

  it('keeps a fallback background when the astronomy image fails', () => {
    act(() => root.render(createElement(AstronomyBackdrop, { variant: 'qa' })));

    const image = container.querySelector('img')!;
    act(() => image.dispatchEvent(new Event('error', { bubbles: true })));

    const fallback = container.querySelector<HTMLElement>('[data-astronomy-status="fallback"]');
    const layerClassNames = Array.from(fallback?.children ?? [], child => child.className);

    expect(container.querySelector('img')).toBeNull();
    expect(fallback?.className).toBe(BASE_BACKGROUND_CLASS_NAME);
    expect(layerClassNames).toHaveLength(2);
    expect(layerClassNames).toContain(`${LAYER_BASE_CLASS_NAME} ${QA_WASH_CLASS_NAME}`);
    expect(layerClassNames).toContain(VIGNETTE_CLASS_NAME);
  });

  it('attempts the new asset after a failed variant changes', () => {
    act(() => root.render(createElement(AstronomyBackdrop, { variant: 'workspace' })));

    const failedImage = container.querySelector('img')!;
    act(() => failedImage.dispatchEvent(new Event('error', { bubbles: true })));
    act(() => root.render(createElement(AstronomyBackdrop, { variant: 'reading' })));

    const backdrop = container.querySelector<HTMLElement>('[data-astronomy-backdrop="reading"]');
    const image = backdrop?.querySelector('img');

    expect(image).not.toBeNull();
    expect(image!.src).toContain('southern-ring-reading');
    expect(backdrop?.getAttribute('data-astronomy-status')).toBe('ready');
  });
});
