import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  AstronomyBackdrop,
  type AstronomyBackdropVariant,
} from '../AstronomyBackdrop';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const backdrops: Array<[AstronomyBackdropVariant, string]> = [
  ['dormant', 'horsehead-dormant'],
  ['library', 'tarantula-library'],
  ['qa', 'tarantula-qa'],
  ['workspace', 'cosmic-cliffs-workspace'],
  ['reading', 'southern-ring-reading'],
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
  it.each(backdrops)('renders the decorative %s image', (variant, filename) => {
    act(() => root.render(createElement(AstronomyBackdrop, { variant })));

    const backdrop = container.querySelector<HTMLElement>(`[data-astronomy-backdrop="${variant}"]`);
    const image = backdrop?.querySelector('img');

    expect(backdrop).not.toBeNull();
    expect(image?.src).toContain(filename);
    expect(image?.alt).toBe('');
    expect(backdrop?.getAttribute('aria-hidden')).toBe('true');
    expect(backdrop?.className).toContain('pointer-events-none');
  });

  it('keeps a fallback background when the astronomy image fails', () => {
    act(() => root.render(createElement(AstronomyBackdrop, { variant: 'qa' })));

    const image = container.querySelector('img')!;
    act(() => image.dispatchEvent(new Event('error', { bubbles: true })));

    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('[data-astronomy-status="fallback"]')).not.toBeNull();
  });
});
