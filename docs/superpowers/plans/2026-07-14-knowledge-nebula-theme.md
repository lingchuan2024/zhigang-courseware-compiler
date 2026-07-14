# Knowledge Nebula Theme Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the entire Zhigang application to a deep-space visual system and add a performant, data-driven course nebula background whose bright-star density grows with real knowledge-topic counts.

**Architecture:** Persist one lightweight nebula summary per course in IndexedDB whenever a project snapshot changes, then load only those summaries on the home screen. Render deterministic nebulae in a single Canvas 2D surface with pure layout/camera helpers, while the rest of the application uses semantic dark-theme tokens and stable reading surfaces.

**Tech Stack:** React 18, TypeScript, Zustand, Vite, Tailwind CSS, Canvas 2D, IndexedDB, Vitest, Testing Library.

---

## File structure

**Create**

- `src/lib/nebula/nebula-summary.ts` — normalize topic names and build lightweight per-course summaries.
- `src/lib/nebula/nebula-layout.ts` — deterministic course placement, palette selection, star placement, and scene bounds.
- `src/lib/nebula/nebula-camera.ts` — pure pan, zoom, clamp, and fit-to-view calculations.
- `src/lib/nebula/__tests__/nebula-summary.test.ts` — summary and duplicate-topic coverage.
- `src/lib/nebula/__tests__/nebula-layout.test.ts` — stable layout and quantity-scaling coverage.
- `src/lib/nebula/__tests__/nebula-camera.test.ts` — cursor-anchored zoom and boundary coverage.
- `src/components/nebula/KnowledgeNebulaBackground.tsx` — Canvas lifecycle, offscreen rendering, camera animation, and fallback.
- `src/components/nebula/NebulaViewportControls.tsx` — zoom, fit-view, and accessible controls.
- `src/components/nebula/ProjectMark.tsx` — enlarged Zhigang project name.
- `src/components/nebula/__tests__/KnowledgeNebulaBackground.test.tsx` — lifecycle and controls integration.

**Modify**

- `src/types/index.ts` — add persisted nebula summary types.
- `src/lib/library-repository.ts` — add summary store, rebuild summaries on save/delete, and list summaries.
- `src/lib/__tests__/library-repository.test.ts` — verify summary persistence and cascade behavior.
- `src/store/useLibraryStore.ts` — load summaries into library state.
- `src/components/HomeView.tsx` — replace the paper hero with nebula background and minimal foreground.
- `src/components/__tests__/LibraryNavigation.test.tsx` — cover home nebula navigation and empty state.
- `tailwind.config.js` — remap legacy color aliases and add semantic space colors.
- `src/index.css` — global dark tokens, controls, scrollbars, focus, and reduced-motion rules.
- `src/components/AppShell.tsx`, `src/components/Sidebar.tsx`, `src/components/LibraryView.tsx`, `src/components/SettingsModal.tsx` — core shell migration.
- `src/components/document-review/*.tsx`, `src/components/MinerUParseView.tsx`, `src/components/UploadView.tsx` — document workflow migration while preserving source colors.
- `src/components/KnowledgeStructureView.tsx`, `src/components/knowledge-network/*.tsx`, `src/components/KnowledgeCardsView.tsx` — dark knowledge workspace and focus-only functional relation lines.
- `src/components/MasterNoteView.tsx`, `src/components/MarkdownNotesView.tsx`, `src/components/NotesView.tsx`, `src/components/KnowledgeQaView.tsx`, `src/components/markdown-components.tsx`, `src/components/markdown.css` — stable dark reading and QA surfaces.

## Task 1: Nebula summary types and pure builder

**Files:**
- Create: `src/lib/nebula/nebula-summary.ts`
- Create: `src/lib/nebula/__tests__/nebula-summary.test.ts`
- Modify: `src/types/index.ts`

- [ ] **Step 1: Write the failing summary tests**

```ts
import { describe, expect, it } from 'vitest';
import { buildCourseNebulaSummary } from '../nebula-summary';

describe('buildCourseNebulaSummary', () => {
  it('merges normalized topic occurrences across course documents', () => {
    const result = buildCourseNebulaSummary({
      course: { id: 'course-1', name: '机器学习', documentIds: ['a', 'b'], createdAt: 1, updatedAt: 4 },
      documents: [
        { id: 'a', courseId: 'course-1', title: 'A', fileName: 'a.pdf', fileType: 'pdf', pageCount: 1, stage: 'cards', status: 'ready', uploadedAt: 1, updatedAt: 2 },
        { id: 'b', courseId: 'course-1', title: 'B', fileName: 'b.pdf', fileType: 'pdf', pageCount: 1, stage: 'cards', status: 'ready', uploadedAt: 1, updatedAt: 4 },
      ],
      snapshots: [
        { documentId: 'a', topics: [{ id: 't1', name: 'Softmax', aliases: [], importance: 'core', sourceRangeCount: 2 }], cards: [] },
        { documentId: 'b', topics: [{ id: 't2', name: ' softmax ', aliases: [], importance: 'important', sourceRangeCount: 1 }], cards: [{ topicId: 't2', status: 'complete' }] },
      ],
    });

    expect(result.knowledgeCount).toBe(1);
    expect(result.stars[0]).toMatchObject({ sourceDocumentCount: 2, evidenceCount: 3, cardStatus: 'complete' });
  });

  it('uses no bright stars when snapshots contain no topics', () => {
    const result = buildCourseNebulaSummary({
      course: { id: 'empty', name: '空课程', documentIds: [], createdAt: 1, updatedAt: 1 },
      documents: [],
      snapshots: [],
    });
    expect(result.knowledgeCount).toBe(0);
    expect(result.stars).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `pnpm test -- src/lib/nebula/__tests__/nebula-summary.test.ts`

Expected: FAIL because `nebula-summary.ts` and summary types do not exist.

- [ ] **Step 3: Add the persisted types**

Add to `src/types/index.ts`:

```ts
export type NebulaCardStatus = 'none' | 'partial' | 'complete' | 'failed';

export interface KnowledgeStarSummary {
  key: string;
  name: string;
  sourceDocumentCount: number;
  evidenceCount: number;
  importance: 'core' | 'important' | 'supplementary';
  cardStatus: NebulaCardStatus;
}

export interface CourseNebulaSummary {
  version: 1;
  courseId: string;
  courseName: string;
  documentCount: number;
  knowledgeCount: number;
  completedCardCount: number;
  updatedAt: number;
  paletteId: string;
  seed: number;
  stars: KnowledgeStarSummary[];
}
```

- [ ] **Step 4: Implement the pure builder**

Implement `normalizeKnowledgeKey`, stable FNV-1a hashing, importance merging, and card-state merging in `nebula-summary.ts`. The public input must be:

```ts
export interface NebulaSnapshotInput {
  documentId: string;
  topics: Array<{ id: string; name: string; aliases: string[]; importance: KnowledgeStarSummary['importance']; sourceRangeCount: number }>;
  cards: Array<{ topicId: string; status: 'none' | 'partial' | 'complete' | 'failed' }>;
}

export function buildCourseNebulaSummary(input: {
  course: LibraryCourse;
  documents: LibraryDocument[];
  snapshots: NebulaSnapshotInput[];
}): CourseNebulaSummary;
```

Use `normalize('NFKC')`, lowercase Latin text, trim whitespace, and remove internal whitespace/punctuation for the visual-only merge key. Preserve the first non-empty display name.

- [ ] **Step 5: Run the summary tests**

Run: `pnpm test -- src/lib/nebula/__tests__/nebula-summary.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/types/index.ts src/lib/nebula/nebula-summary.ts src/lib/nebula/__tests__/nebula-summary.test.ts
git commit -m "Add knowledge nebula summaries"
```

## Task 2: Persist and cascade course nebula summaries

**Files:**
- Modify: `src/lib/library-repository.ts`
- Modify: `src/lib/__tests__/library-repository.test.ts`

- [ ] **Step 1: Write failing repository tests**

Add tests that save two document snapshots with overlapping topics, call `listCourseNebulaSummaries()`, delete one document, then delete the course. Assert that source counts decrease after document deletion and the summary disappears after course deletion.

```ts
expect((await listCourseNebulaSummaries())[0].stars[0].sourceDocumentCount).toBe(2);
await deleteLibraryDocumentCascade('doc-2');
expect((await listCourseNebulaSummaries())[0].stars[0].sourceDocumentCount).toBe(1);
await deleteLibraryCourseCascade(course.id);
expect(await listCourseNebulaSummaries()).toEqual([]);
```

- [ ] **Step 2: Run the repository test and verify it fails**

Run: `pnpm test -- src/lib/__tests__/library-repository.test.ts`

Expected: FAIL because `listCourseNebulaSummaries` is not exported.

- [ ] **Step 3: Add the IndexedDB store and memory fallback**

In `library-repository.ts`:

```ts
const DB_VERSION = 3;
const NEBULA_SUMMARIES = 'nebula-summaries';

const memory = {
  // existing maps
  nebulaSummaries: new Map<string, CourseNebulaSummary>(),
};
```

Create the object store with `{ keyPath: 'courseId' }` during upgrade.

- [ ] **Step 4: Add rebuild and list functions**

Implement:

```ts
export async function rebuildCourseNebulaSummary(courseId: string): Promise<CourseNebulaSummary | null>;
export async function listCourseNebulaSummaries(): Promise<CourseNebulaSummary[]>;
```

`rebuildCourseNebulaSummary` must read the course, its documents, and their snapshots, convert `knowledgeTopics` and `knowledgeCards` to `NebulaSnapshotInput`, then call `buildCourseNebulaSummary`. It must store only the resulting summary.

- [ ] **Step 5: Wire rebuilds into mutations**

After `saveLibraryProjectSnapshot`, rebuild the course. After document deletion, rebuild the remaining course. During course deletion, delete its summary in the same cascade transaction. Clear the summary map/store in `resetLibraryRepositoryForTests`.

- [ ] **Step 6: Run repository tests**

Run: `pnpm test -- src/lib/__tests__/library-repository.test.ts`

Expected: PASS, including the v1→v3 IndexedDB upgrade test.

- [ ] **Step 7: Commit**

```bash
git add src/lib/library-repository.ts src/lib/__tests__/library-repository.test.ts
git commit -m "Persist course nebula summaries"
```

## Task 3: Load summaries through the library store

**Files:**
- Modify: `src/store/useLibraryStore.ts`
- Modify: `src/components/__tests__/LibraryNavigation.test.tsx`

- [ ] **Step 1: Add a failing initialization assertion**

Mock `listCourseNebulaSummaries` and assert that initialization stores the returned summaries:

```ts
expect(useLibraryStore.getState().nebulaSummaries).toEqual([
  expect.objectContaining({ courseId: 'course-1', knowledgeCount: 3 }),
]);
```

- [ ] **Step 2: Run the focused test**

Run: `pnpm test -- src/components/__tests__/LibraryNavigation.test.tsx`

Expected: FAIL because `nebulaSummaries` is absent.

- [ ] **Step 3: Extend `LibraryState` and loader**

Add `nebulaSummaries: CourseNebulaSummary[]`. Update `loadLibraryData` to load courses, documents, and summaries in parallel. Ensure `initialize`, `refresh`, deletion, and creation preserve or replace the field consistently.

- [ ] **Step 4: Run the focused test**

Run: `pnpm test -- src/components/__tests__/LibraryNavigation.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/store/useLibraryStore.ts src/components/__tests__/LibraryNavigation.test.tsx
git commit -m "Expose nebula summaries in library state"
```

## Task 4: Deterministic layout and camera math

**Files:**
- Create: `src/lib/nebula/nebula-layout.ts`
- Create: `src/lib/nebula/nebula-camera.ts`
- Create: `src/lib/nebula/__tests__/nebula-layout.test.ts`
- Create: `src/lib/nebula/__tests__/nebula-camera.test.ts`

- [ ] **Step 1: Write failing layout tests**

Cover stable placement, growing radius, brighter-star caps, and non-identical course positions:

```ts
expect(layoutNebulaScene(input)).toEqual(layoutNebulaScene(input));
expect(scene.courses[1].radius).toBeGreaterThan(scene.courses[0].radius);
expect(scene.courses[1].stars.length).toBeLessThanOrEqual(120);
expect(new Set(scene.courses.map(course => `${course.x}:${course.y}`)).size).toBe(scene.courses.length);
```

- [ ] **Step 2: Write failing camera tests**

```ts
const before = screenToWorld({ x: 400, y: 300 }, camera);
const zoomed = zoomAtPoint(camera, { x: 400, y: 300 }, 1.4, bounds);
expect(screenToWorld({ x: 400, y: 300 }, zoomed)).toEqual(before);
expect(clampCamera({ x: -100, y: 9999, zoom: 1 }, bounds, viewport)).toMatchObject({ x: 0 });
```

- [ ] **Step 3: Run tests and verify failure**

Run: `pnpm test -- src/lib/nebula/__tests__/nebula-layout.test.ts src/lib/nebula/__tests__/nebula-camera.test.ts`

Expected: FAIL because both modules are missing.

- [ ] **Step 4: Implement layout**

Use stable seeded random values from `summary.seed`. Set radius with `clamp(180 + Math.sqrt(knowledgeCount) * 34, 220, 640)`. Render up to 120 full stars per course and convert remaining topics into small cluster density. Select palettes by `paletteId`; include red, cyan, cobalt, amber, violet, and dark dust layers.

- [ ] **Step 5: Implement camera helpers**

Export:

```ts
export interface NebulaCamera { x: number; y: number; zoom: number }
export function clampCamera(camera: NebulaCamera, bounds: SceneBounds, viewport: Size): NebulaCamera;
export function zoomAtPoint(camera: NebulaCamera, point: Point, nextZoom: number, bounds: SceneBounds, viewport: Size): NebulaCamera;
export function fitScene(bounds: SceneBounds, viewport: Size, padding?: number): NebulaCamera;
export function edgePanVelocity(pointer: Point, viewport: Size, threshold?: number): Point;
```

Clamp zoom to `0.6–1.8` and keep the world coordinate under the pointer stable.

- [ ] **Step 6: Run the focused tests**

Run: `pnpm test -- src/lib/nebula/__tests__/nebula-layout.test.ts src/lib/nebula/__tests__/nebula-camera.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/nebula
git commit -m "Add deterministic nebula layout and camera"
```

## Task 5: Canvas renderer and viewport controls

**Files:**
- Create: `src/components/nebula/KnowledgeNebulaBackground.tsx`
- Create: `src/components/nebula/NebulaViewportControls.tsx`
- Create: `src/components/nebula/ProjectMark.tsx`
- Create: `src/components/nebula/__tests__/KnowledgeNebulaBackground.test.tsx`

- [ ] **Step 1: Write failing component tests**

Mock `HTMLCanvasElement.prototype.getContext`, `requestAnimationFrame`, and `matchMedia`. Assert that the renderer creates one Canvas, renders the empty fallback, exposes `放大`, `缩小`, and `适应全部星云`, and removes listeners on unmount.

- [ ] **Step 2: Run the component test and verify failure**

Run: `pnpm test -- src/components/nebula/__tests__/KnowledgeNebulaBackground.test.tsx`

Expected: FAIL because the components do not exist.

- [ ] **Step 3: Implement controls and project mark**

`ProjectMark` renders only the enlarged `知纲` name and optional small subtitle. `NebulaViewportControls` receives `zoom`, `onZoomIn`, `onZoomOut`, and `onFit`, with visible labels and accessible names.

- [ ] **Step 4: Implement Canvas lifecycle**

`KnowledgeNebulaBackground` must:

- accept `summaries`, `onCourseOpen`, and `reducedMotion`;
- call `layoutNebulaScene` only when summaries or viewport size changes;
- pre-render static gas, red emission clouds, cyan/blue regions, amber dust, dark occlusion lanes, and knowledge stars to an offscreen Canvas;
- use one animation loop for camera interpolation and subtle star breathing;
- cap DPR at 1.6 and lower it for small screens;
- pause on `visibilitychange` and clean up every listener/RAF on unmount;
- use edge panning on pointer devices, wheel zoom around the pointer, button zoom, fit view, single-finger drag, and pinch zoom;
- expose course hotspots as real buttons positioned above the Canvas;
- fall back to a CSS deep-space gradient if `getContext('2d')` returns null.

- [ ] **Step 5: Run the component tests**

Run: `pnpm test -- src/components/nebula/__tests__/KnowledgeNebulaBackground.test.tsx`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/nebula
git commit -m "Build interactive knowledge nebula canvas"
```

## Task 6: Replace the home page

**Files:**
- Modify: `src/components/HomeView.tsx`
- Modify: `src/components/AppShell.tsx`
- Modify: `src/components/__tests__/LibraryNavigation.test.tsx`

- [ ] **Step 1: Write failing home behavior tests**

Assert that the home page renders `知纲`, does not render `OBSERVATORY ONLINE`, coordinates, or `CURRENT SURVEY`, and that clicking a course hotspot calls `openCourse`.

- [ ] **Step 2: Run the focused test**

Run: `pnpm test -- src/components/__tests__/LibraryNavigation.test.tsx`

Expected: FAIL against the current paper hero.

- [ ] **Step 3: Implement the new home composition**

Replace the feature-card grid with:

```tsx
<main className="relative min-h-screen overflow-hidden bg-space-950 text-space-text">
  <KnowledgeNebulaBackground summaries={nebulaSummaries} onCourseOpen={courseId => void openCourse(courseId)} />
  <ProjectMark />
  <section className="relative z-10 ...">
    <h1>知识被观测，星云才会发光。</h1>
    <p>每门课程形成一团独特星云……</p>
    <button onClick={() => navigate('library')}>进入课件库</button>
    <button onClick={() => navigate('qa')}>全库知识问答</button>
  </section>
</main>
```

When there are no summaries, show only a calm field and the first-import action. Keep `AppShell` off the home page so no header is restored.

- [ ] **Step 4: Run focused tests**

Run: `pnpm test -- src/components/__tests__/LibraryNavigation.test.tsx src/components/nebula/__tests__/KnowledgeNebulaBackground.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/HomeView.tsx src/components/AppShell.tsx src/components/__tests__/LibraryNavigation.test.tsx
git commit -m "Replace home with the knowledge nebula"
```

## Task 7: Establish global semantic dark-theme tokens

**Files:**
- Modify: `tailwind.config.js`
- Modify: `src/index.css`

- [ ] **Step 1: Add semantic colors and compatible aliases**

Map Tailwind colors as follows:

```js
colors: {
  space: {
    950: '#010207', 900: '#040914', 850: '#07101d', 800: '#0a1625', 750: '#102238',
    border: '#1d3349', 'border-strong': '#31536d', text: '#edf7fc', muted: '#778da2',
  },
  paper: '#07101d',
  'paper-dark': '#0a1625',
  ink: '#edf7fc',
  'ink-light': '#b1c3d1',
  celadon: '#78cde3',
  'celadon-light': '#a8e5f3',
  cinnabar: '#d9655d',
  'cinnabar-light': '#ed8880',
  charcoal: '#edf7fc',
}
```

- [ ] **Step 2: Update global component classes**

Change `body`, `.config-input`, `.btn-*`, `.card`, scrollbars, focus rings, selection, PPTX surrounding chrome, and reduced-motion rules to dark semantic surfaces. Add `color-scheme: dark`. Inputs must retain readable placeholder text.

- [ ] **Step 3: Run type and build checks**

Run: `pnpm check && pnpm build`

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add tailwind.config.js src/index.css
git commit -m "Add the deep-space design tokens"
```

## Task 8: Migrate shell, library, sidebar, and settings

**Files:**
- Modify: `src/components/AppShell.tsx`
- Modify: `src/components/Sidebar.tsx`
- Modify: `src/components/LibraryView.tsx`
- Modify: `src/components/SettingsModal.tsx`

- [ ] **Step 1: Replace hard-coded paper surfaces**

Use `bg-space-950`, `bg-space-900/95`, `bg-space-850`, `border-space-border`, `text-space-text`, and `text-space-muted`. Preserve existing responsive layout and event handlers.

- [ ] **Step 2: Keep state colors semantic**

Ready/complete uses cyan-green, processing/stale uses amber, failure/delete uses muted red. Do not make every border glow.

- [ ] **Step 3: Run navigation and settings tests**

Run: `pnpm test -- src/components/__tests__/LibraryNavigation.test.tsx src/lib/__tests__/model-config-storage.test.ts`

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/AppShell.tsx src/components/Sidebar.tsx src/components/LibraryView.tsx src/components/SettingsModal.tsx
git commit -m "Migrate the core shell to deep space"
```

## Task 9: Migrate document and knowledge workspaces

**Files:**
- Modify: `src/components/UploadView.tsx`
- Modify: `src/components/MinerUParseView.tsx`
- Modify: `src/components/document-review/*.tsx`
- Modify: `src/components/KnowledgeStructureView.tsx`
- Modify: `src/components/knowledge-network/KnowledgeNetworkCanvas.tsx`
- Modify: `src/components/knowledge-network/SourceEvidencePanel.tsx`
- Modify: `src/components/KnowledgeCardsView.tsx`

- [ ] **Step 1: Migrate document workspace chrome**

Convert toolbars, inspectors, navigation, empty states, and upload surfaces to semantic dark colors. Keep rendered PDF/PPTX pages white/original and change only the surrounding viewport, shadows, and outlines.

- [ ] **Step 2: Migrate the knowledge structure workspace**

Use dark SVG node fills and light labels. Functional relation lines remain low-opacity by default and increase opacity only for selected/hovered neighborhoods. Do not add relation lines to the home nebula.

- [ ] **Step 3: Migrate cards and evidence panels**

Use stable deep-blue cards, readable secondary text, dark code/Markdown blocks, and subtle cyan source markers. Remove remaining cream surfaces and green-tinted shadows.

- [ ] **Step 4: Run workflow and visual-structure tests**

Run:

```bash
pnpm test -- \
  src/components/__tests__/UploadFileTypes.test.tsx \
  src/components/__tests__/MinerUParseView.test.tsx \
  src/components/__tests__/ContinuousDocumentPreview.test.tsx \
  src/components/__tests__/KnowledgeNetworkCanvas.test.tsx \
  src/components/__tests__/SourceEvidencePanel.test.tsx \
  src/components/__tests__/KnowledgeCardsView.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/UploadView.tsx src/components/MinerUParseView.tsx src/components/document-review src/components/KnowledgeStructureView.tsx src/components/knowledge-network src/components/KnowledgeCardsView.tsx
git commit -m "Theme document and knowledge workspaces"
```

## Task 10: Migrate notes, Markdown, QA, and final verification

**Files:**
- Modify: `src/components/MasterNoteView.tsx`
- Modify: `src/components/MarkdownNotesView.tsx`
- Modify: `src/components/NotesView.tsx`
- Modify: `src/components/KnowledgeQaView.tsx`
- Modify: `src/components/markdown-components.tsx`
- Modify: `src/components/markdown.css`

- [ ] **Step 1: Migrate reading surfaces**

Use high-contrast static deep-blue surfaces. Headings are near-white, body text is `#b1c3d1`, tables use `#102238` headers, inline code uses `#0a1625`, blockquotes use cyan borders, and KaTeX inherits the body color. No reading content receives text glow.

- [ ] **Step 2: Migrate QA to a dark exploration log**

Keep the conversation model and message actions unchanged. Use dark history navigation, stable assistant content, cyan citation coordinates, and a deep input composer. User messages may use one higher-contrast blue surface; failures use muted red.

- [ ] **Step 3: Search for remaining light-theme literals**

Run:

```bash
rg -n "#f5f0e8|#fffdfa|#faf7f0|#173f35|bg-white|text-stone-[6789]|border-stone-[23]" src/components src/index.css
```

Expected: no remaining full-page cream backgrounds or unreadable dark text on dark surfaces. Any deliberate `bg-white` must be limited to rendered source pages, not application chrome.

- [ ] **Step 4: Run the full verification suite**

Run:

```bash
pnpm test
pnpm check
pnpm build
pnpm lint
```

Expected: all commands PASS.

- [ ] **Step 5: Verify reduced motion and Canvas fallback**

Run the focused component tests with `matchMedia('(prefers-reduced-motion: reduce)')` mocked true and `getContext` returning null. Expected: the page remains usable, controls remain keyboard accessible, and navigation is present.

- [ ] **Step 6: Commit**

```bash
git add src/components/MasterNoteView.tsx src/components/MarkdownNotesView.tsx src/components/NotesView.tsx src/components/KnowledgeQaView.tsx src/components/markdown-components.tsx src/components/markdown.css
git commit -m "Finish the knowledge nebula theme"
```

## Final integration checkpoint

- [ ] Confirm `git status --short` contains no unintended staged files.
- [ ] Confirm the nebula uses real course summaries and does not draw fake knowledge stars.
- [ ] Confirm more knowledge topics produce more bright stars and a denser, more colorful nebula.
- [ ] Confirm the home page shows the enlarged “知纲” project name and no rejected header/survey chrome.
- [ ] Confirm wheel/button/pinch zoom, fit-view, drag, and edge panning work within bounds.
- [ ] Confirm all non-home pages use stable dark surfaces and keep source documents unaltered.
- [ ] Run `pnpm test && pnpm check && pnpm build && pnpm lint` one final time.
