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
const QA_WASH_CLASS_NAME = 'bg-[linear-gradient(105deg,rgba(2,4,10,.93)_0%,rgba(5,6,18,.68)_58%,rgba(2,4,10,.9)_100%)]';

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
    imageClassName: 'object-[54%_46%] opacity-[0.18] saturate-[0.62] brightness-[0.68] md:opacity-[0.22]',
    washClassName: 'bg-[linear-gradient(112deg,rgba(1,2,7,.88)_0%,rgba(2,5,12,.66)_52%,rgba(1,2,7,.91)_100%)]',
  },
  {
    variant: 'library',
    filename: 'tarantula-library',
    imageClassName: 'object-[58%_42%] opacity-[0.18] saturate-[0.82] brightness-[0.68] md:opacity-[0.22]',
    washClassName: 'bg-[linear-gradient(110deg,rgba(2,4,10,.91)_0%,rgba(3,7,15,.64)_56%,rgba(2,4,10,.88)_100%)]',
  },
  {
    variant: 'qa',
    filename: 'tarantula-qa',
    imageClassName: 'object-[52%_42%] opacity-[0.15] saturate-[0.8] brightness-[0.64] md:opacity-[0.19]',
    washClassName: QA_WASH_CLASS_NAME,
  },
  {
    variant: 'workspace',
    filename: 'cosmic-cliffs-workspace',
    imageClassName: 'object-[58%_45%] opacity-[0.14] saturate-[0.72] brightness-[0.62] md:opacity-[0.18]',
    washClassName: 'bg-[linear-gradient(108deg,rgba(2,4,10,.92)_0%,rgba(3,7,14,.68)_55%,rgba(2,4,10,.9)_100%)]',
  },
  {
    variant: 'reading',
    filename: 'southern-ring-reading',
    imageClassName: 'object-center opacity-[0.1] saturate-[0.66] brightness-[0.58] md:opacity-[0.13]',
    washClassName: 'bg-[radial-gradient(circle_at_55%_44%,rgba(3,7,14,.7)_0%,rgba(2,4,10,.9)_66%,rgba(1,2,7,.97)_100%)]',
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
});
