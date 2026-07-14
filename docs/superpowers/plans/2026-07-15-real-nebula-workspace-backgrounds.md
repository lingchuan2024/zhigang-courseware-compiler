# Real Nebula Workspace Backgrounds Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add five locally hosted NASA/Webb nebula backgrounds to the knowledge universe while keeping all task content dominant and making the no-course home state quiet and text-free.

**Architecture:** A presentation-only `AstronomyBackdrop` owns image selection, crop, veil, vignette, failure fallback, and accessibility. `AppShell`, the course-workspace root, and the empty knowledge-nebula state select variants; business views remain responsible for their content and expose the image only through calibrated translucent surfaces.

**Tech Stack:** React 18, TypeScript, Tailwind CSS, Vite asset imports, Vitest + jsdom, NASA/Webb source PNGs converted with `cwebp`.

---

## File map

**Create**

- `src/assets/astronomy/horsehead-dormant.webp` — dim empty-home image.
- `src/assets/astronomy/tarantula-library.webp` — courseware-library image.
- `src/assets/astronomy/tarantula-qa.webp` — knowledge-QA image.
- `src/assets/astronomy/cosmic-cliffs-workspace.webp` — upload/parse/structure/cards image.
- `src/assets/astronomy/southern-ring-reading.webp` — notes/reading image.
- `src/assets/astronomy/ATTRIBUTION.md` — official sources, credits, and in-product usage.
- `src/components/backgrounds/AstronomyBackdrop.tsx` — variant-to-image mapping, crop, veil, vignette, and fallback.
- `src/components/backgrounds/__tests__/AstronomyBackdrop.test.tsx` — presentation and failure behavior.
- `src/components/__tests__/AppShell.test.tsx` — shell background contract and navigation regression.

**Modify**

- `src/components/AppShell.tsx` — accept an optional background variant and keep shell content above it.
- `src/components/LibraryView.tsx` — select `library` and make large surfaces translucent but content-dominant.
- `src/App.tsx` — select `qa`, `workspace`, or `reading` at the appropriate application boundary.
- `src/components/KnowledgeQaView.tsx` — replace opaque roots with calibrated dark translucent surfaces.
- `src/components/Sidebar.tsx` — let the workspace image appear faintly around navigation without reducing legibility.
- `src/components/UploadView.tsx` — expose the workspace background through the outer canvas.
- `src/components/document-review/DocumentReviewWorkspace.tsx` — expose the workspace background around document panels.
- `src/components/MinerUParseView.tsx` — expose the workspace background around parser panels.
- `src/components/KnowledgeStructureView.tsx` — expose the workspace background around the knowledge network.
- `src/components/KnowledgeCardsView.tsx` — expose the workspace background around cards while keeping card surfaces strong.
- `src/components/NotesView.tsx` — use the heaviest translucent reading surfaces.
- `src/components/HomeView.tsx` — show only brand, dim nebula, settings, and one courseware entry when empty.
- `src/components/nebula/KnowledgeNebulaBackground.tsx` — use the dormant backdrop when empty and hide data-only UI.
- `src/components/nebula/__tests__/KnowledgeNebulaBackground.test.tsx` — lock the new empty behavior.
- `src/components/__tests__/LibraryNavigation.test.tsx` — lock empty-home copy and page variant mapping.

## Task 1: Acquire, optimize, and attribute the five official images

**Files:**

- Create: `src/assets/astronomy/horsehead-dormant.webp`
- Create: `src/assets/astronomy/tarantula-library.webp`
- Create: `src/assets/astronomy/tarantula-qa.webp`
- Create: `src/assets/astronomy/cosmic-cliffs-workspace.webp`
- Create: `src/assets/astronomy/southern-ring-reading.webp`
- Create: `src/assets/astronomy/ATTRIBUTION.md`

- [ ] **Step 1: Download bounded official display assets to a temporary directory**

Run:

```bash
mkdir -p /private/tmp/zhigang-nebula-assets src/assets/astronomy
curl -L 'https://assets.science.nasa.gov/dynamicimage/assets/science/missions/webb/science/2024/04/STScI-01HV4CG0EACM1MC07E10X19KNX.png?crop=faces%2Cfocalpoint&fit=clip&h=1800&w=1800' -o /private/tmp/zhigang-nebula-assets/horsehead.png
curl -L 'https://assets.science.nasa.gov/dynamicimage/assets/science/missions/webb/science/2022/09/STScI-01GA76Q01D09HFEV174SVMQDMV.png?crop=faces%2Cfocalpoint&fit=clip&h=1157&w=2000' -o /private/tmp/zhigang-nebula-assets/tarantula-nircam.png
curl -L 'https://assets.science.nasa.gov/dynamicimage/assets/science/missions/webb/science/2022/09/STScI-01GA77CSHSPPS2P0C6QR3M6X6F.png?crop=faces%2Cfocalpoint&fit=clip&h=1059&w=1397' -o /private/tmp/zhigang-nebula-assets/tarantula-miri.png
curl -L 'https://assets.science.nasa.gov/dynamicimage/assets/science/missions/webb/science/2022/07/STScI-01GA6KKWG229B16K4Q38CH3BXS.png?crop=faces%2Cfocalpoint&fit=clip&h=1158&w=2000' -o /private/tmp/zhigang-nebula-assets/cosmic-cliffs.png
curl -L 'https://assets.science.nasa.gov/dynamicimage/assets/science/missions/webb/science/2022/07/STScI-01G8H005ETS4YHYA6XGG1XE7G2.png?crop=faces%2Cfocalpoint&fit=clip&h=1133&w=1306' -o /private/tmp/zhigang-nebula-assets/southern-ring.png
```

Expected: five PNG files with non-zero sizes. Verify with:

```bash
file /private/tmp/zhigang-nebula-assets/*.png
```

Expected: every line reports `PNG image data`.

- [ ] **Step 2: Convert to local WebP assets**

Run:

```bash
cwebp -quiet -q 78 -m 6 -resize 1800 0 /private/tmp/zhigang-nebula-assets/horsehead.png -o src/assets/astronomy/horsehead-dormant.webp
cwebp -quiet -q 78 -m 6 -resize 2000 0 /private/tmp/zhigang-nebula-assets/tarantula-nircam.png -o src/assets/astronomy/tarantula-library.webp
cwebp -quiet -q 78 -m 6 -resize 1600 0 /private/tmp/zhigang-nebula-assets/tarantula-miri.png -o src/assets/astronomy/tarantula-qa.webp
cwebp -quiet -q 78 -m 6 -resize 2000 0 /private/tmp/zhigang-nebula-assets/cosmic-cliffs.png -o src/assets/astronomy/cosmic-cliffs-workspace.webp
cwebp -quiet -q 78 -m 6 -resize 1600 0 /private/tmp/zhigang-nebula-assets/southern-ring.png -o src/assets/astronomy/southern-ring-reading.webp
```

Expected: five WebP files. Verify dimensions and total payload:

```bash
file src/assets/astronomy/*.webp
du -ch src/assets/astronomy/*.webp
```

Expected: every asset reports `Web/P image`; combined size should remain below 5 MB. If the combined size is above 5 MB, rerun all five commands with `-q 72` and repeat verification.

- [ ] **Step 3: Add the attribution record**

Create `src/assets/astronomy/ATTRIBUTION.md` with exactly:

```markdown
# Astronomy image attribution

These images are decorative background assets. They do not represent interactive knowledge points and do not imply endorsement by NASA, ESA, CSA, or STScI.

| Local asset | Object and official source | Credit | Used in |
| --- | --- | --- | --- |
| `horsehead-dormant.webp` | [Horsehead Nebula, NIRCam](https://science.nasa.gov/asset/webb/horsehead-nebula-nircam-image/) | NASA, ESA, CSA, Karl Misselt (University of Arizona), Alain Abergel (IAS, CNRS) | Empty home |
| `tarantula-library.webp` | [Tarantula Nebula, NIRCam](https://science.nasa.gov/asset/webb/tarantula-nebula-nircam-image/) | NASA, ESA, CSA, STScI, Webb ERO Production Team | Courseware library |
| `tarantula-qa.webp` | [Tarantula Nebula, MIRI](https://science.nasa.gov/asset/webb/tarantula-nebula-miri-image/) | NASA, ESA, CSA, STScI, Webb ERO Production Team | Knowledge QA |
| `cosmic-cliffs-workspace.webp` | [Cosmic Cliffs in the Carina Nebula, NIRCam](https://science.nasa.gov/asset/webb/cosmic-cliffs-in-the-carina-nebula-nircam-image/) | NASA, ESA, CSA, STScI | Course processing workspace |
| `southern-ring-reading.webp` | [Southern Ring Nebula, MIRI](https://science.nasa.gov/asset/webb/southern-ring-nebula-miri-image/) | NASA, ESA, CSA, STScI | Notes and reading |

Usage guidance: [NASA Images and Media Usage Guidelines](https://www.nasa.gov/nasa-brand-center/images-and-media/).
```

- [ ] **Step 4: Commit the asset set**

```bash
git add src/assets/astronomy
git commit -m "Add official nebula background assets"
```

## Task 2: Build the isolated astronomy background component with TDD

**Files:**

- Create: `src/components/backgrounds/AstronomyBackdrop.tsx`
- Create: `src/components/backgrounds/__tests__/AstronomyBackdrop.test.tsx`

- [ ] **Step 1: Write the failing component tests**

Create `src/components/backgrounds/__tests__/AstronomyBackdrop.test.tsx`:

```tsx
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AstronomyBackdrop } from '../AstronomyBackdrop';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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
  it.each([
    ['dormant', 'horsehead-dormant'],
    ['library', 'tarantula-library'],
    ['qa', 'tarantula-qa'],
    ['workspace', 'cosmic-cliffs-workspace'],
    ['reading', 'southern-ring-reading'],
  ] as const)('maps %s to its local decorative image', (variant, expectedFile) => {
    act(() => root.render(createElement(AstronomyBackdrop, { variant })));

    const backdrop = container.querySelector(`[data-astronomy-backdrop="${variant}"]`)!;
    const image = backdrop.querySelector('img')!;
    expect(image.getAttribute('src')).toContain(expectedFile);
    expect(image.getAttribute('alt')).toBe('');
    expect(backdrop.getAttribute('aria-hidden')).toBe('true');
    expect(backdrop.className).toContain('pointer-events-none');
  });

  it('keeps the deep-space fallback after an image error', () => {
    act(() => root.render(createElement(AstronomyBackdrop, { variant: 'qa' })));
    const image = container.querySelector('img')!;
    act(() => image.dispatchEvent(new Event('error')));

    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('[data-astronomy-status="fallback"]')).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify the missing component failure**

Run:

```bash
pnpm test -- src/components/backgrounds/__tests__/AstronomyBackdrop.test.tsx
```

Expected: FAIL because `../AstronomyBackdrop` does not exist.

- [ ] **Step 3: Implement the minimal component and all calibrated variants**

Create `src/components/backgrounds/AstronomyBackdrop.tsx`:

```tsx
import { useState } from 'react';
import cosmicCliffsWorkspace from '../../assets/astronomy/cosmic-cliffs-workspace.webp';
import horseheadDormant from '../../assets/astronomy/horsehead-dormant.webp';
import southernRingReading from '../../assets/astronomy/southern-ring-reading.webp';
import tarantulaLibrary from '../../assets/astronomy/tarantula-library.webp';
import tarantulaQa from '../../assets/astronomy/tarantula-qa.webp';

export type AstronomyBackdropVariant = 'dormant' | 'library' | 'qa' | 'workspace' | 'reading';

interface AstronomyBackdropProps {
  variant: AstronomyBackdropVariant;
}

const BACKDROPS: Record<AstronomyBackdropVariant, {
  src: string;
  imageClassName: string;
  washClassName: string;
}> = {
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

export function AstronomyBackdrop({ variant }: AstronomyBackdropProps) {
  const [failed, setFailed] = useState(false);
  const backdrop = BACKDROPS[variant];

  return (
    <div
      aria-hidden="true"
      data-astronomy-backdrop={variant}
      data-astronomy-status={failed ? 'fallback' : 'ready'}
      className="pointer-events-none absolute inset-0 overflow-hidden bg-[#02040a]"
    >
      {!failed && (
        <img
          src={backdrop.src}
          alt=""
          decoding="async"
          onError={() => setFailed(true)}
          className={`absolute inset-0 h-full w-full object-cover ${backdrop.imageClassName}`}
        />
      )}
      <div className={`absolute inset-0 ${backdrop.washClassName}`} />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_0%,rgba(0,2,7,.2)_58%,rgba(0,1,5,.68)_100%)]" />
    </div>
  );
}
```

- [ ] **Step 4: Run the focused tests and type check**

Run:

```bash
pnpm test -- src/components/backgrounds/__tests__/AstronomyBackdrop.test.tsx
pnpm check
```

Expected: 2 tests PASS; TypeScript exits 0.

- [ ] **Step 5: Commit the component**

```bash
git add src/components/backgrounds
git commit -m "Add reusable astronomy backdrop"
```

## Task 3: Connect page variants through the shell and workspace root

**Files:**

- Create: `src/components/__tests__/AppShell.test.tsx`
- Modify: `src/components/AppShell.tsx`
- Modify: `src/components/LibraryView.tsx`
- Modify: `src/App.tsx`
- Modify: `src/components/__tests__/LibraryNavigation.test.tsx`

- [ ] **Step 1: Write the failing `AppShell` contract tests**

Create `src/components/__tests__/AppShell.test.tsx`:

```tsx
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppShell } from '../AppShell';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

describe('AppShell', () => {
  it('renders the selected decorative background behind shell content', () => {
    act(() => root.render(createElement(AppShell, {
      onHome: vi.fn(),
      backdrop: 'library',
      children: createElement('p', null, '主体内容'),
    })));

    expect(container.querySelector('[data-astronomy-backdrop="library"]')).not.toBeNull();
    expect(container.querySelector('[data-app-shell-content]')?.textContent).toContain('主体内容');
  });

  it('preserves home navigation', () => {
    const onHome = vi.fn();
    act(() => root.render(createElement(AppShell, {
      onHome,
      children: createElement('p', null, '主体内容'),
    })));

    act(() => container.querySelector<HTMLButtonElement>('header button')!.click());
    expect(onHome).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Add failing application mapping assertions**

In `src/components/__tests__/LibraryNavigation.test.tsx`, add to the existing `starts at home, creates a course, and opens its upload workspace` test immediately after opening the library:

```tsx
expect(container!.querySelector('[data-astronomy-backdrop="library"]')).not.toBeNull();
```

Then add a new test in the same `describe` block:

```tsx
it('uses distinct backgrounds for QA and the course workspace', async () => {
  await act(async () => root!.render(createElement(App)));

  act(() => useLibraryStore.getState().navigate('qa'));
  await act(async () => undefined);
  expect(container!.querySelector('[data-astronomy-backdrop="qa"]')).not.toBeNull();

  useLibraryStore.getState().navigate('home');
  await act(async () => undefined);
  await act(async () => button('进入课件库').click());
  const input = container!.querySelector<HTMLInputElement>('input[placeholder="例如：机器学习"]')!;
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setter.call(input, '机器学习');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => button('创建课程').click());
  await act(async () => button('添加课件').click());

  expect(container!.querySelector('[data-astronomy-backdrop="workspace"]')).not.toBeNull();
});
```

- [ ] **Step 3: Run the focused tests to verify contract failures**

Run:

```bash
pnpm test -- src/components/__tests__/AppShell.test.tsx src/components/__tests__/LibraryNavigation.test.tsx
```

Expected: FAIL because `AppShell` has no `backdrop` prop and application routes have no astronomy backdrop.

- [ ] **Step 4: Implement the shell contract**

Replace `src/components/AppShell.tsx` with:

```tsx
import type { ReactNode } from 'react';
import { AstronomyBackdrop, type AstronomyBackdropVariant } from './backgrounds/AstronomyBackdrop';

interface AppShellProps {
  children: ReactNode;
  onHome: () => void;
  action?: ReactNode;
  backdrop?: AstronomyBackdropVariant;
}

export function AppShell({ children, onHome, action, backdrop }: AppShellProps) {
  return (
    <div className="relative min-h-screen overflow-hidden bg-space-950 text-space-text">
      {backdrop ? <AstronomyBackdrop variant={backdrop} /> : null}
      <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-space-border bg-space-900/[0.92] px-6 backdrop-blur-xl md:px-10">
        <button type="button" onClick={onHome} className="group flex items-baseline gap-3 text-left">
          <span className="font-song text-2xl font-bold tracking-[0.16em] text-ink">知纲</span>
          <span className="hidden font-mono text-[10px] tracking-[0.24em] text-space-muted sm:inline">KNOWLEDGE UNIVERSE</span>
        </button>
        {action}
      </header>
      <div data-app-shell-content className="relative z-10">{children}</div>
    </div>
  );
}
```

- [ ] **Step 5: Select `library`, `qa`, `workspace`, and `reading` at their stable boundaries**

In `src/components/LibraryView.tsx`, add the prop to the existing shell:

```tsx
<AppShell
  backdrop="library"
  onHome={() => navigate('home')}
  action={<button type="button" onClick={() => navigate('home')} className="text-sm text-ink/70 hover:text-ink">← 返回首页</button>}
>
```

In `src/App.tsx`, import the background component:

```tsx
import { AstronomyBackdrop } from './components/backgrounds/AstronomyBackdrop';
```

Change the QA shell opening tag to:

```tsx
<AppShell
  backdrop="qa"
  onHome={() => navigateLibrary('home')}
  action={<button type="button" onClick={() => navigateLibrary('library')} className="text-sm text-ink/70">课件库</button>}
>
```

Replace the final course-workspace return block in `src/App.tsx` with:

```tsx
return (
  <div className="relative h-screen overflow-hidden bg-space-950">
    <AstronomyBackdrop variant={stage === 'notes' ? 'reading' : 'workspace'} />
    <div className="relative z-10 flex h-full overflow-hidden">
      <div className="md:hidden fixed top-4 left-4 z-40">
        <button
          onClick={() => {
            const sidebar = document.querySelector('aside');
            if (sidebar) sidebar.classList.toggle('-translate-x-full');
          }}
          className="bg-ink text-white p-2 rounded shadow-lg"
          aria-label="打开菜单"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
      </div>

      <Sidebar onOpenSettings={() => setSettingsOpen(true)} />
      <main className="flex-1 flex flex-col overflow-hidden">{renderStage()}</main>
      <SettingsModal isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  </div>
);
```

- [ ] **Step 6: Run the focused tests**

Run:

```bash
pnpm test -- src/components/__tests__/AppShell.test.tsx src/components/__tests__/LibraryNavigation.test.tsx
```

Expected: both files PASS.

- [ ] **Step 7: Commit the page mapping**

```bash
git add src/App.tsx src/components/AppShell.tsx src/components/LibraryView.tsx src/components/__tests__/AppShell.test.tsx src/components/__tests__/LibraryNavigation.test.tsx
git commit -m "Map workspace pages to nebula backgrounds"
```

## Task 4: Make the empty home a quiet dormant universe

**Files:**

- Modify: `src/components/nebula/__tests__/KnowledgeNebulaBackground.test.tsx`
- Modify: `src/components/nebula/KnowledgeNebulaBackground.tsx`
- Modify: `src/components/__tests__/LibraryNavigation.test.tsx`
- Modify: `src/components/HomeView.tsx`

- [ ] **Step 1: Replace the old empty-state test with the desired behavior**

In `src/components/nebula/__tests__/KnowledgeNebulaBackground.test.tsx`, replace `keeps the empty state and controls usable when Canvas 2D is unavailable` with:

```tsx
it('shows a dormant nebula without data-only copy, controls, or hotspots when empty', () => {
  vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue(null);
  act(() => root.render(createElement(KnowledgeNebulaBackground, {
    summaries: [],
    onCourseOpen: vi.fn(),
    reducedMotion: true,
  })));

  expect(container.querySelector('[data-astronomy-backdrop="dormant"]')).not.toBeNull();
  expect(container.textContent).not.toContain('还没有被点亮的知识星');
  expect(container.textContent).not.toContain('导入并解析课件后');
  expect(container.querySelector('[aria-label="放大星云"]')).toBeNull();
  expect(container.querySelector('[aria-label^="打开课程："]')).toBeNull();
  expect(container.querySelector('[data-canvas-fallback="true"]')).not.toBeNull();
});
```

In the `starts at home, creates a course, and opens its upload workspace` test in `src/components/__tests__/LibraryNavigation.test.tsx`, replace the first home assertions with:

```tsx
expect(container!.textContent).toContain('知纲');
expect(container!.textContent).not.toContain('还没有被点亮的知识星');
expect(container!.textContent).not.toContain('知识被观测，星云才会发光。');
expect(container!.querySelector('[data-astronomy-backdrop="dormant"]')).not.toBeNull();
expect(button('添加课件')).not.toBeNull();
```

In the `returns from the library to the start page` test, replace the last assertion with:

```tsx
expect(container!.querySelector('[data-astronomy-backdrop="dormant"]')).not.toBeNull();
expect(container!.textContent).not.toContain('还没有被点亮的知识星');
```

Finally, in the same test file replace every empty-home navigation call:

```tsx
await act(async () => button('进入课件库').click());
```

with:

```tsx
await act(async () => button('添加课件').click());
```

This includes the QA/workspace mapping test added in Task 3 after it returns to the empty home.

- [ ] **Step 2: Run the tests to verify the old empty UI fails**

Run:

```bash
pnpm test -- src/components/nebula/__tests__/KnowledgeNebulaBackground.test.tsx src/components/__tests__/LibraryNavigation.test.tsx
```

Expected: FAIL because the old explanatory card and controls still render, and there is no dormant background.

- [ ] **Step 3: Add the dormant backdrop and hide data-only UI when empty**

In `src/components/nebula/KnowledgeNebulaBackground.tsx`, add:

```tsx
import { AstronomyBackdrop } from '../backgrounds/AstronomyBackdrop';
```

Inside the returned root `<div>`, immediately before the existing radial-gradient layer, add:

```tsx
{!hasKnowledge ? <AstronomyBackdrop variant="dormant" /> : null}
```

Change the canvas class so the data canvas is absent visually when empty:

```tsx
className={`absolute inset-0 h-full w-full cursor-grab touch-none active:cursor-grabbing ${hasKnowledge ? '' : 'hidden'}`}
```

Delete the entire old `!hasKnowledge` explanatory card block. Replace the unconditional controls with:

```tsx
{hasKnowledge ? (
  <NebulaViewportControls
    zoom={zoomLabel}
    onZoomIn={() => zoomBy(1.22)}
    onZoomOut={() => zoomBy(1 / 1.22)}
    onFit={fitAll}
  />
) : null}
```

Keep `data-canvas-fallback` on the root so unavailable Canvas remains observable and harmless.

- [ ] **Step 4: Simplify only the empty branch in `HomeView`**

In `src/components/HomeView.tsx`, replace the existing bottom `<section>` with this conditional structure. Keep the populated hero text and its two actions inside the `hasKnowledge` branch exactly as shown:

```tsx
{hasKnowledge ? (
  <section className="pointer-events-none absolute inset-x-0 bottom-0 z-30 px-6 pb-24 pt-36 md:px-10 md:pb-14 lg:w-[55rem] lg:bg-[linear-gradient(90deg,rgba(1,2,7,.82)_0%,rgba(1,2,7,.46)_58%,transparent_100%)] lg:pr-36">
    <div className="pointer-events-auto max-w-2xl">
      <p className="mb-4 font-mono text-[10px] tracking-[0.32em] text-[#63bfce] md:text-xs">YOUR KNOWLEDGE, OBSERVED</p>
      <h1 className="font-song text-4xl font-bold leading-[1.14] tracking-[-0.02em] text-[#f3f8fa] drop-shadow-[0_4px_30px_rgba(0,0,0,.75)] md:text-6xl lg:text-7xl">
        知识被观测，<br className="hidden sm:block" />星云才会发光。
      </h1>
      <p className="mt-5 max-w-xl text-sm leading-7 text-[#91a8b8] md:text-base md:leading-8">
        每门课程聚成一团独特星云，每个被课件证明的知识点才会成为一颗亮星。知识越丰富，宇宙越绚烂。
      </p>
      <div className="mt-7 flex flex-wrap gap-3">
        <button type="button" onClick={() => navigate('library')} className="rounded-xl border border-[#82dfeb]/40 bg-[#b8edf3] px-5 py-3 text-sm font-semibold text-[#031018] shadow-[0_0_32px_rgba(91,207,224,.16)] transition hover:-translate-y-0.5 hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#72d9e8]">
          进入课件库
        </button>
        <button type="button" onClick={() => navigate('qa')} className="rounded-xl border border-white/12 bg-white/[0.045] px-5 py-3 text-sm font-medium text-[#b5c8d4] backdrop-blur-md transition hover:-translate-y-0.5 hover:border-white/25 hover:bg-white/[0.09] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#72d9e8]">
          全库知识问答
        </button>
      </div>
    </div>
  </section>
) : (
  <button
    type="button"
    onClick={() => navigate('library')}
    className="absolute bottom-10 left-1/2 z-30 -translate-x-1/2 rounded-xl border border-[#82dfeb]/32 bg-[#07111b]/82 px-6 py-3 text-sm font-semibold text-[#e7f8fb] shadow-[0_18px_48px_rgba(0,0,0,.42)] backdrop-blur-xl transition hover:-translate-y-0.5 hover:border-[#82dfeb]/55 hover:bg-[#0b1925] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#72d9e8] md:bottom-14"
  >
    添加课件
  </button>
)}
```

The existing bottom-right viewport hint already uses `hasKnowledge`; keep it unchanged.

- [ ] **Step 5: Run the empty and populated home tests**

Run:

```bash
pnpm test -- src/components/nebula/__tests__/KnowledgeNebulaBackground.test.tsx src/components/__tests__/LibraryNavigation.test.tsx
```

Expected: both files PASS. The populated hotspot test proves data-driven interaction remains available.

- [ ] **Step 6: Commit the quiet empty home**

```bash
git add src/components/HomeView.tsx src/components/nebula/KnowledgeNebulaBackground.tsx src/components/nebula/__tests__/KnowledgeNebulaBackground.test.tsx src/components/__tests__/LibraryNavigation.test.tsx
git commit -m "Simplify the dormant knowledge universe"
```

## Task 5: Tune work surfaces so the subject stays dominant

**Files:**

- Modify: `src/components/LibraryView.tsx`
- Modify: `src/components/KnowledgeQaView.tsx`
- Modify: `src/components/Sidebar.tsx`
- Modify: `src/components/UploadView.tsx`
- Modify: `src/components/document-review/DocumentReviewWorkspace.tsx`
- Modify: `src/components/MinerUParseView.tsx`
- Modify: `src/components/KnowledgeStructureView.tsx`
- Modify: `src/components/KnowledgeCardsView.tsx`
- Modify: `src/components/NotesView.tsx`

- [ ] **Step 1: Apply exact outer-surface replacements**

Use the following exact class replacements. Do not lower the opacity of cards, form controls, messages, citations, document pages, modal backdrops, or destructive-confirmation dialogs.

`src/components/LibraryView.tsx`:

```tsx
// before
<aside className="border-r border-space-border bg-space-900 p-5 md:p-7">
<section className="p-6 md:p-10">
<article key={document.id} className="group relative rounded-2xl border border-space-border bg-space-850 transition hover:-translate-y-0.5 hover:border-celadon/45 hover:shadow-[0_18px_38px_rgba(0,0,0,.28)]">

// after
<aside className="border-r border-space-border bg-space-900/[0.88] p-5 backdrop-blur-xl md:p-7">
<section className="bg-space-950/[0.72] p-6 backdrop-blur-[2px] md:p-10">
<article key={document.id} className="group relative rounded-2xl border border-space-border bg-space-850/[0.94] backdrop-blur-xl transition hover:-translate-y-0.5 hover:border-celadon/45 hover:shadow-[0_18px_38px_rgba(0,0,0,.28)]">
```

`src/components/KnowledgeQaView.tsx`:

```tsx
// before
<div className="relative h-[calc(100dvh-4rem)] min-h-0 overflow-hidden bg-space-950">
className="grid h-[calc(100dvh-4rem)] min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden bg-space-950 text-space-text md:grid-cols-[264px_minmax(0,1fr)] md:grid-rows-1"
<aside className="z-10 flex max-h-[220px] min-h-0 flex-col border-b border-space-border bg-space-900 md:max-h-none md:border-b-0 md:border-r">
<main className="flex min-h-0 min-w-0 flex-col bg-[radial-gradient(circle_at_50%_0%,rgba(35,83,118,0.16),transparent_42%)]">

// after
<div className="relative h-[calc(100dvh-4rem)] min-h-0 overflow-hidden bg-space-950/[0.68]">
className="grid h-[calc(100dvh-4rem)] min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden bg-space-950/[0.72] text-space-text md:grid-cols-[264px_minmax(0,1fr)] md:grid-rows-1"
<aside className="z-10 flex max-h-[220px] min-h-0 flex-col border-b border-space-border bg-space-900/[0.92] backdrop-blur-xl md:max-h-none md:border-b-0 md:border-r">
<main className="flex min-h-0 min-w-0 flex-col bg-space-950/[0.64] backdrop-blur-[2px]">
```

`src/components/Sidebar.tsx`:

```tsx
// before
<aside className="flex h-screen w-56 flex-shrink-0 -translate-x-full flex-col border-r border-space-border bg-space-900 text-space-text transition-transform duration-300 md:w-64 md:translate-x-0">

// after
<aside className="flex h-screen w-56 flex-shrink-0 -translate-x-full flex-col border-r border-space-border bg-space-900/[0.92] text-space-text backdrop-blur-xl transition-transform duration-300 md:w-64 md:translate-x-0">
```

`src/components/UploadView.tsx`:

```tsx
// before
<div className="flex-1 overflow-y-auto bg-space-950 p-8 flex items-center justify-center">

// after
<div className="flex flex-1 items-center justify-center overflow-y-auto bg-space-950/[0.72] p-8 backdrop-blur-[2px]">
```

`src/components/document-review/DocumentReviewWorkspace.tsx`:

```tsx
// before — both root occurrences
<div className="flex h-screen flex-1 flex-col overflow-hidden bg-space-950">
// after — both root occurrences
<div className="flex h-screen flex-1 flex-col overflow-hidden bg-space-950/[0.78]">

// before
<div className="flex flex-shrink-0 items-center justify-between border-b border-space-border bg-space-900 px-6 py-3">
<aside className="hidden w-[148px] flex-shrink-0 overflow-hidden border-r border-space-border bg-space-900 lg:block xl:w-[168px]">

// after
<div className="flex flex-shrink-0 items-center justify-between border-b border-space-border bg-space-900/[0.94] px-6 py-3 backdrop-blur-xl">
<aside className="hidden w-[148px] flex-shrink-0 overflow-hidden border-r border-space-border bg-space-900/[0.94] backdrop-blur-xl lg:block xl:w-[168px]">
```

`src/components/MinerUParseView.tsx`:

```tsx
// before
<div className="flex min-h-0 flex-1 flex-col bg-space-950">
<header className="flex h-16 flex-shrink-0 items-center justify-between border-b border-space-border bg-space-900 px-6">
<aside className="w-64 flex-shrink-0 overflow-y-auto border-r border-space-border bg-space-900 p-5">

// after
<div className="flex min-h-0 flex-1 flex-col bg-space-950/[0.76]">
<header className="flex h-16 flex-shrink-0 items-center justify-between border-b border-space-border bg-space-900/[0.94] px-6 backdrop-blur-xl">
<aside className="w-64 flex-shrink-0 overflow-y-auto border-r border-space-border bg-space-900/[0.94] p-5 backdrop-blur-xl">
```

`src/components/KnowledgeStructureView.tsx`:

```tsx
// before
<div className="grid flex-1 place-items-center bg-space-950">
<div className="flex h-screen min-w-0 flex-1 flex-col overflow-hidden bg-space-950">
<header className="flex h-[72px] flex-shrink-0 items-center justify-between gap-4 border-b border-space-border bg-space-900 px-5">

// after
<div className="grid flex-1 place-items-center bg-space-950/[0.74]">
<div className="flex h-screen min-w-0 flex-1 flex-col overflow-hidden bg-space-950/[0.72]">
<header className="flex h-[72px] flex-shrink-0 items-center justify-between gap-4 border-b border-space-border bg-space-900/[0.94] px-5 backdrop-blur-xl">
```

`src/components/KnowledgeCardsView.tsx`:

```tsx
// before — update the matching roots in both V2 and legacy branches
<div className="grid h-screen flex-1 place-items-center bg-space-950 px-8 text-center">
<div className="flex h-screen min-w-0 flex-1 flex-col overflow-hidden bg-space-950 text-space-text">
<aside className="w-72 flex-shrink-0 overflow-y-auto border-r border-space-border bg-space-900 p-3">
<aside className="w-80 flex-shrink-0 overflow-y-auto border-l border-space-border bg-space-900 p-4">

// after
<div className="grid h-screen flex-1 place-items-center bg-space-950/[0.76] px-8 text-center">
<div className="flex h-screen min-w-0 flex-1 flex-col overflow-hidden bg-space-950/[0.72] text-space-text">
<aside className="w-72 flex-shrink-0 overflow-y-auto border-r border-space-border bg-space-900/[0.94] p-3 backdrop-blur-xl">
<aside className="w-80 flex-shrink-0 overflow-y-auto border-l border-space-border bg-space-900/[0.94] p-4 backdrop-blur-xl">
```

`src/components/NotesView.tsx`:

```tsx
// before
<div className="flex h-screen flex-1 flex-col overflow-hidden bg-space-950 text-space-text">
<header className="flex flex-shrink-0 items-center justify-between border-b border-space-border bg-space-900/95 px-6 py-3 backdrop-blur-xl">
<aside className="w-64 flex-shrink-0 overflow-y-auto border-r border-space-border bg-space-900">

// after
<div className="flex h-screen flex-1 flex-col overflow-hidden bg-space-950/[0.82] text-space-text">
<header className="flex flex-shrink-0 items-center justify-between border-b border-space-border bg-space-900/[0.97] px-6 py-3 backdrop-blur-xl">
<aside className="w-64 flex-shrink-0 overflow-y-auto border-r border-space-border bg-space-900/[0.96] backdrop-blur-xl">
```

- [ ] **Step 2: Run affected component tests**

Run:

```bash
pnpm test -- src/components/__tests__/UploadFileTypes.test.tsx src/components/__tests__/MinerUParseView.test.tsx src/components/__tests__/KnowledgeStructureView.network.test.tsx src/components/__tests__/KnowledgeCardsView.test.tsx src/components/__tests__/NotesView.v2.test.tsx src/components/__tests__/KnowledgeQaView.test.tsx src/components/__tests__/LibraryNavigation.test.tsx
```

Expected: all affected suites PASS; styling must not alter business behavior or accessibility hooks.

- [ ] **Step 3: Run targeted lint on all changed source files**

Run:

```bash
pnpm exec eslint src/App.tsx src/components/AppShell.tsx src/components/LibraryView.tsx src/components/KnowledgeQaView.tsx src/components/Sidebar.tsx src/components/UploadView.tsx src/components/document-review/DocumentReviewWorkspace.tsx src/components/MinerUParseView.tsx src/components/KnowledgeStructureView.tsx src/components/KnowledgeCardsView.tsx src/components/NotesView.tsx src/components/HomeView.tsx src/components/nebula/KnowledgeNebulaBackground.tsx src/components/backgrounds/AstronomyBackdrop.tsx
```

Expected: exit 0. Existing warnings may remain, but this task must introduce no lint errors.

- [ ] **Step 4: Commit the calibrated surface hierarchy**

```bash
git add src/components/LibraryView.tsx src/components/KnowledgeQaView.tsx src/components/Sidebar.tsx src/components/UploadView.tsx src/components/document-review/DocumentReviewWorkspace.tsx src/components/MinerUParseView.tsx src/components/KnowledgeStructureView.tsx src/components/KnowledgeCardsView.tsx src/components/NotesView.tsx
git commit -m "Keep workspace content above nebula imagery"
```

## Task 6: Verify visual hierarchy, fallback behavior, and the complete application

**Files:**

- Verify only; modify the task files above only if a test or visual check reveals a scoped defect.

- [ ] **Step 1: Run the full automated suite**

Run:

```bash
pnpm test
pnpm check
pnpm build
```

Expected: all tests PASS, TypeScript exits 0, and Vite produces a successful production build containing five hashed WebP assets.

- [ ] **Step 2: Run source-only lint**

Run:

```bash
pnpm exec eslint src vite.config.ts
```

Expected: exit 0 with no errors. Do not treat unrelated untracked third-party evaluation bundles as this feature's lint scope.

- [ ] **Step 3: Start the application and inspect every mapped scene**

Run:

```bash
pnpm dev --host 127.0.0.1
```

Check at desktop and narrow viewport widths:

1. Empty home: large “知纲”, dormant Horsehead background, one “添加课件” action, no empty explanation, no zoom controls.
2. Populated home: data-driven course nebula and hotspots remain brighter and interactive.
3. Library: rust/blue Tarantula image is visible only around opaque courseware surfaces.
4. QA: purple MIRI image is secondary to history, answer timeline, citations, and composer.
5. Upload/parse/structure/cards: Cosmic Cliffs is visible around the workspace, never through document pages or card text.
6. Notes: Southern Ring is faintest; long-form text is the first visual focus.
7. Mobile: no image layer captures taps, obscures text, or causes horizontal overflow.
8. Simulated image failure: removing one image request in browser tools leaves the deep-space gradient and all content usable.

- [ ] **Step 4: Review the repository diff and commit any verification-only corrections**

Run:

```bash
git status --short
git diff --check
git diff --stat
```

Expected: no whitespace errors; only planned source, test, asset, attribution, spec, and plan files are present. Do not stage `.pnpm-store/`, `.superpowers/`, `.trae-html-share-packages/`, `cosmic-universe-test/`, `deep-space-cosmic/`, `project-evaluation/`, or the unrelated untracked stellar-theme spec.

If verification required a scoped correction, commit only those corrected files:

```bash
git add src/App.tsx src/components/AppShell.tsx src/components/LibraryView.tsx src/components/KnowledgeQaView.tsx src/components/Sidebar.tsx src/components/UploadView.tsx src/components/document-review/DocumentReviewWorkspace.tsx src/components/MinerUParseView.tsx src/components/KnowledgeStructureView.tsx src/components/KnowledgeCardsView.tsx src/components/NotesView.tsx src/components/HomeView.tsx src/components/nebula/KnowledgeNebulaBackground.tsx src/components/backgrounds/AstronomyBackdrop.tsx src/components/__tests__/AppShell.test.tsx src/components/__tests__/LibraryNavigation.test.tsx src/components/nebula/__tests__/KnowledgeNebulaBackground.test.tsx src/components/backgrounds/__tests__/AstronomyBackdrop.test.tsx
git commit -m "Polish real nebula workspace backgrounds"
```

If no correction was required, do not create an empty commit.
