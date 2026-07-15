# Dormant Home Landing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the empty knowledge-universe home state with a complete, responsive “editorial observatory” landing page while preserving the populated interactive universe.

**Architecture:** `HomeView` remains the state boundary: it reads `nebulaSummaries` and renders either a new pure `DormantHomeLanding` or the existing populated-universe UI. The landing component owns only presentation, navigation callbacks, and viewport reveal behavior; it does not read course data or mutate stores.

**Tech Stack:** React 18, TypeScript, Zustand navigation, Tailwind CSS, Vitest, React DOM test utilities.

---

## File Map

- Create `src/components/home/DormantHomeLanding.tsx`: complete empty-state landing page and pure navigation callbacks.
- Create `src/components/home/RevealSection.tsx`: isolated IntersectionObserver-based reveal primitive with reduced-motion-safe fallback.
- Create `src/components/home/__tests__/DormantHomeLanding.test.tsx`: content, navigation, background, and reveal behavior.
- Modify `src/components/HomeView.tsx`: render the landing only when no knowledge exists; leave populated behavior intact.
- Modify `src/components/__tests__/LibraryNavigation.test.tsx`: update empty-home integration expectations and QA navigation coverage.

## Task 1: Build the reveal primitive

**Files:**
- Create: `src/components/home/RevealSection.tsx`
- Create: `src/components/home/__tests__/DormantHomeLanding.test.tsx`

- [ ] **Step 1: Write the failing reveal tests**

Create the test harness and verify both the IntersectionObserver path and the fallback path:

```tsx
import { act, createElement, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RevealSection } from '../RevealSection';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];

afterEach(() => {
  act(() => roots.splice(0).forEach(root => root.unmount()));
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

function render(element: ReactElement) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(element));
  return container;
}

describe('RevealSection', () => {
  it('reveals immediately when IntersectionObserver is unavailable', () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    const container = render(createElement(RevealSection, null, 'chapter'));
    expect(container.firstElementChild?.getAttribute('data-revealed')).toBe('true');
  });

  it('reveals once when the section enters the viewport', () => {
    let callback: IntersectionObserverCallback | undefined;
    const disconnect = vi.fn();
    vi.stubGlobal('IntersectionObserver', vi.fn((next: IntersectionObserverCallback) => {
      callback = next;
      return { observe: vi.fn(), disconnect, unobserve: vi.fn(), takeRecords: vi.fn(), root: null, rootMargin: '', thresholds: [0] };
    }));

    const container = render(createElement(RevealSection, null, 'chapter'));
    expect(container.firstElementChild?.getAttribute('data-revealed')).toBe('false');
    act(() => callback?.([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver));
    expect(container.firstElementChild?.getAttribute('data-revealed')).toBe('true');
    expect(disconnect).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test and confirm the missing-module failure**

Run:

```bash
./node_modules/.bin/vitest run src/components/home/__tests__/DormantHomeLanding.test.tsx
```

Expected: FAIL because `../RevealSection` does not exist.

- [ ] **Step 3: Implement `RevealSection`**

Create:

```tsx
import { type ReactNode, useEffect, useRef, useState } from 'react';

interface RevealSectionProps {
  children: ReactNode;
  className?: string;
  id?: string;
}

export function RevealSection({ children, className = '', id }: RevealSectionProps) {
  const ref = useRef<HTMLElement>(null);
  const [revealed, setRevealed] = useState(() => typeof IntersectionObserver === 'undefined');

  useEffect(() => {
    const element = ref.current;
    if (!element || revealed) return;
    if (typeof IntersectionObserver === 'undefined') {
      setRevealed(true);
      return;
    }

    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return;
      setRevealed(true);
      observer.disconnect();
    }, { rootMargin: '0px 0px -12% 0px', threshold: 0.08 });
    observer.observe(element);
    return () => observer.disconnect();
  }, [revealed]);

  return (
    <section
      ref={ref}
      id={id}
      data-revealed={revealed}
      className={`${className} transition duration-700 ease-out motion-reduce:transform-none motion-reduce:transition-none ${revealed ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0'}`}
    >
      {children}
    </section>
  );
}
```

- [ ] **Step 4: Run the focused test**

Run the command from Step 2.

Expected: 2 tests PASS.

- [ ] **Step 5: Commit the primitive**

```bash
git add src/components/home/RevealSection.tsx src/components/home/__tests__/DormantHomeLanding.test.tsx
git commit -m "Add landing page reveal sections"
```

## Task 2: Build the editorial observatory landing

**Files:**
- Create: `src/components/home/DormantHomeLanding.tsx`
- Modify: `src/components/home/__tests__/DormantHomeLanding.test.tsx`

- [ ] **Step 1: Add failing content and navigation tests**

Append these tests and import `DormantHomeLanding`:

```tsx
import { DormantHomeLanding } from '../DormantHomeLanding';

function button(container: HTMLElement, name: string) {
  return Array.from(container.querySelectorAll('button')).find(item => item.textContent?.trim() === name)!;
}

it('presents the complete product story over the dormant backdrop', () => {
  const container = render(createElement(DormantHomeLanding, {
    onOpenLibrary: vi.fn(), onOpenQa: vi.fn(), onOpenSettings: vi.fn(),
  }));

  expect(container.querySelector('[data-astronomy-backdrop="dormant"]')).not.toBeNull();
  expect(container.textContent).toContain('让每一份课件，成为可探索的知识宇宙。');
  expect(container.textContent).toContain('知识结构');
  expect(container.textContent).toContain('知识卡片');
  expect(container.textContent).toContain('完整笔记');
  expect(container.textContent).toContain('全库知识问答');
  expect(container.textContent).toContain('导入课程材料');
  expect(container.textContent).toContain('你的知识宇宙，等待第一次观测。');
  expect(container.textContent).not.toContain('还没有被点亮的知识星');
});

it('exposes the library, QA, settings, and workflow actions', () => {
  const onOpenLibrary = vi.fn();
  const onOpenQa = vi.fn();
  const onOpenSettings = vi.fn();
  const container = render(createElement(DormantHomeLanding, { onOpenLibrary, onOpenQa, onOpenSettings }));

  act(() => button(container, '添加第一份课件').click());
  act(() => button(container, '全库知识问答').click());
  act(() => button(container, '服务配置').click());

  expect(onOpenLibrary).toHaveBeenCalledTimes(1);
  expect(onOpenQa).toHaveBeenCalledTimes(1);
  expect(onOpenSettings).toHaveBeenCalledTimes(1);
  expect(container.querySelector('a[href="#workflow"]')).not.toBeNull();
});
```

- [ ] **Step 2: Run the focused test and confirm failure**

Run:

```bash
./node_modules/.bin/vitest run src/components/home/__tests__/DormantHomeLanding.test.tsx
```

Expected: FAIL because `DormantHomeLanding` does not exist.

- [ ] **Step 3: Implement the landing page**

Create the component with this exact interface, content model, semantic order, and callback behavior. Preserve the class intent shown here when refining spacing:

```tsx
import { AstronomyBackdrop } from '../backgrounds/AstronomyBackdrop';
import { RevealSection } from './RevealSection';

interface DormantHomeLandingProps {
  onOpenLibrary: () => void;
  onOpenQa: () => void;
  onOpenSettings: () => void;
}

const CAPABILITIES = [
  ['01', '知识结构', '从章节与课件证据中识别概念、层级与关系。'],
  ['02', '知识卡片', '把复杂内容整理为可复习、可检索的知识单元。'],
  ['03', '完整笔记', '围绕课程结构生成连续、可阅读的知识文档。'],
  ['04', '全库知识问答', '跨课程检索，并把回答追溯到原始课件。'],
] as const;

const STEPS = [
  ['01', '导入课程材料', '上传 PDF、PPTX 或 Markdown，让不同资料进入同一课程空间。'],
  ['02', '解析并组织知识', '从原始课件中提取知识点、证据、结构、卡片与笔记。'],
  ['03', '持续探索与提问', '在知识宇宙中浏览课程，也可以向整个知识库发问。'],
] as const;

export function DormantHomeLanding({ onOpenLibrary, onOpenQa, onOpenSettings }: DormantHomeLandingProps) {
  return (
    <main className="relative min-h-screen overflow-x-hidden bg-[#010207] text-[#edf7fc]">
      <div className="fixed inset-0"><AstronomyBackdrop variant="dormant" /></div>
      <div aria-hidden="true" className="pointer-events-none fixed inset-0 bg-[linear-gradient(180deg,rgba(1,2,7,.05),rgba(1,2,7,.72)_78%,#010207)]" />

      <header className="relative z-20 mx-auto flex max-w-[90rem] items-center justify-between px-6 py-6 md:px-10 md:py-8">
        <a href="#top" className="font-song text-4xl font-bold tracking-[0.16em] text-white md:text-5xl">知纲</a>
        <nav aria-label="首页导航" className="flex items-center gap-2 md:gap-3">
          <button type="button" onClick={onOpenLibrary} className="hidden text-sm text-[#9db2bf] hover:text-white sm:block">课件库</button>
          <button type="button" onClick={onOpenQa} className="hidden text-sm text-[#9db2bf] hover:text-white md:block">全库知识问答</button>
          <button type="button" onClick={onOpenSettings} className="rounded-full border border-white/10 bg-[#040914]/55 px-4 py-2 font-mono text-[10px] tracking-[0.18em] text-[#8ca3b3] backdrop-blur-xl hover:text-white">服务配置</button>
        </nav>
      </header>

      <div id="top" className="relative z-10 mx-auto max-w-[90rem] px-6 md:px-10">
        <section className="flex min-h-[78vh] max-w-3xl flex-col justify-center pb-24 pt-16 md:min-h-[82vh]">
          <p className="font-mono text-[10px] tracking-[0.32em] text-[#68c9d8] md:text-xs">FROM COURSEWARE TO KNOWLEDGE</p>
          <h1 className="mt-5 font-song text-5xl font-bold leading-[1.08] tracking-[-0.03em] text-white md:text-7xl lg:text-8xl">让每一份课件，<br />成为可探索的知识宇宙。</h1>
          <p className="mt-7 max-w-2xl text-base leading-8 text-[#9cb0bd] md:text-lg">知纲把分散的课程材料转化为知识结构、知识卡片、完整笔记和可追溯问答，让课程不再只是文件，而是持续生长的知识资产。</p>
          <div className="mt-9 flex flex-wrap gap-3">
            <button type="button" onClick={onOpenLibrary} className="rounded-xl bg-[#b8edf3] px-6 py-3 text-sm font-semibold text-[#031018] hover:bg-white">添加第一份课件</button>
            <button type="button" onClick={onOpenQa} className="rounded-xl border border-white/14 bg-white/[0.05] px-6 py-3 text-sm text-[#c6d7df] backdrop-blur-md hover:bg-white/[0.1] hover:text-white">全库知识问答</button>
            <a href="#workflow" className="rounded-xl px-3 py-3 text-sm text-[#839aa9] hover:text-white">了解如何工作 ↓</a>
          </div>
        </section>

        <RevealSection className="border-y border-white/10 py-20 md:py-28">
          <p className="font-mono text-[10px] tracking-[0.28em] text-[#68c9d8]">01 · KNOWLEDGE SYSTEM</p>
          <div className="mt-10 grid gap-px border-y border-white/10 md:grid-cols-2 xl:grid-cols-4">
            {CAPABILITIES.map(([number, title, description]) => (
              <article key={title} className="border-white/10 px-0 py-8 md:px-7 md:[&:not(:nth-child(2n+1))]:border-l xl:[&:not(:first-child)]:border-l">
                <span className="font-mono text-[10px] text-[#5faab7]">{number}</span>
                <h2 className="mt-5 font-song text-2xl font-bold text-white">{title}</h2>
                <p className="mt-4 text-sm leading-7 text-[#8fa4b2]">{description}</p>
              </article>
            ))}
          </div>
        </RevealSection>

        <RevealSection id="workflow" className="py-20 md:py-32">
          <p className="font-mono text-[10px] tracking-[0.28em] text-[#d57f80]">02 · FROM MATERIAL TO UNIVERSE</p>
          <h2 className="mt-5 max-w-3xl font-song text-4xl font-bold leading-tight text-white md:text-6xl">从课件到星云，只需要三次观测。</h2>
          <div className="mt-14 grid gap-10 md:grid-cols-3">
            {STEPS.map(([number, title, description]) => (
              <article key={title} className="border-t border-white/12 pt-6">
                <span className="font-mono text-[10px] text-[#d57f80]">{number}</span>
                <h3 className="mt-5 font-song text-2xl font-bold text-white">{title}</h3>
                <p className="mt-4 text-sm leading-7 text-[#8fa4b2]">{description}</p>
              </article>
            ))}
          </div>
        </RevealSection>

        <RevealSection className="grid gap-10 border-y border-white/10 py-20 md:grid-cols-[0.9fr_1.1fr] md:py-32">
          <p className="font-mono text-[10px] tracking-[0.28em] text-[#68c9d8]">03 · HOW THE UNIVERSE GLOWS</p>
          <div><h2 className="font-song text-4xl font-bold leading-tight text-white md:text-6xl">课程聚成星云，知识点成为亮星。</h2><p className="mt-7 max-w-2xl text-base leading-8 text-[#9cb0bd]">每门课程聚成一团独特星云，每个被课件证据支持的知识点才会亮起。知识越丰富，你的宇宙越绚烂。</p></div>
        </RevealSection>

        <RevealSection className="py-24 text-center md:py-40">
          <p className="font-mono text-[10px] tracking-[0.28em] text-[#68c9d8]">BEGIN THE FIRST OBSERVATION</p>
          <h2 className="mx-auto mt-6 max-w-4xl font-song text-4xl font-bold text-white md:text-7xl">你的知识宇宙，等待第一次观测。</h2>
          <div className="mt-10 flex flex-wrap justify-center gap-3"><button type="button" onClick={onOpenLibrary} className="rounded-xl bg-[#b8edf3] px-6 py-3 text-sm font-semibold text-[#031018]">添加第一份课件</button><button type="button" onClick={onOpenQa} className="rounded-xl border border-white/14 px-6 py-3 text-sm text-[#c6d7df]">全库知识问答</button></div>
        </RevealSection>
      </div>

      <footer className="relative z-10 border-t border-white/8 px-6 py-7 text-center font-mono text-[9px] tracking-[0.24em] text-[#4e6575]">知纲 · KNOWLEDGE UNIVERSE</footer>
    </main>
  );
}
```

- [ ] **Step 4: Run the focused test**

Run the command from Step 2.

Expected: all landing tests PASS.

- [ ] **Step 5: Commit the landing component**

```bash
git add src/components/home/DormantHomeLanding.tsx src/components/home/RevealSection.tsx src/components/home/__tests__/DormantHomeLanding.test.tsx
git commit -m "Add editorial observatory landing page"
```

## Task 3: Integrate the landing without changing the populated universe

**Files:**
- Modify: `src/components/HomeView.tsx`
- Modify: `src/components/__tests__/LibraryNavigation.test.tsx`

- [ ] **Step 1: Update the integration test first**

In the empty-home test, replace the old single-button expectations with:

```tsx
expect(container!.querySelector('h1')?.textContent).toContain('让每一份课件');
expect(container!.textContent).toContain('知识结构');
expect(container!.textContent).toContain('完整笔记');
expect(container!.textContent).toContain('全库知识问答');
expect(container!.querySelector('[data-astronomy-backdrop="dormant"]')).not.toBeNull();
expect(button('添加第一份课件')).not.toBeNull();
```

Add a QA route assertion:

```tsx
await act(async () => button('全库知识问答').click());
expect(container!.querySelector('[data-astronomy-backdrop="qa"]')).not.toBeNull();
act(() => useLibraryStore.getState().navigate('home'));
await act(async () => {});
```

In the existing populated-nebula test, assert the landing is absent:

```tsx
expect(container!.textContent).not.toContain('让每一份课件，成为可探索的知识宇宙。');
expect(container!.textContent).toContain('知识被观测');
```

- [ ] **Step 2: Run the integration test and confirm failure**

Run:

```bash
./node_modules/.bin/vitest run src/components/__tests__/LibraryNavigation.test.tsx
```

Expected: FAIL because `HomeView` still renders the single empty-state button.

- [ ] **Step 3: Integrate `DormantHomeLanding`**

At the start of `HomeView`, after computing `hasKnowledge`, return the new component when false:

```tsx
import { DormantHomeLanding } from './home/DormantHomeLanding';

if (!hasKnowledge) {
  return (
    <DormantHomeLanding
      onOpenLibrary={() => navigate('library')}
      onOpenQa={() => navigate('qa')}
      onOpenSettings={onOpenSettings}
    />
  );
}
```

Then remove the old empty branch and simplify the existing JSX so it contains only the populated hero, both populated actions, and the viewport hint. Do not alter `KnowledgeNebulaBackground`, `onCourseOpen`, zoom, drag, edge-pan, or populated copy.

- [ ] **Step 4: Run focused and component tests**

Run:

```bash
./node_modules/.bin/vitest run src/components/home/__tests__/DormantHomeLanding.test.tsx src/components/__tests__/LibraryNavigation.test.tsx src/components/nebula/__tests__/KnowledgeNebulaBackground.test.tsx
```

Expected: all focused tests PASS.

- [ ] **Step 5: Commit the integration**

```bash
git add src/components/HomeView.tsx src/components/__tests__/LibraryNavigation.test.tsx
git commit -m "Show the complete landing before knowledge exists"
```

## Task 4: Verify responsive presentation and regressions

- [ ] **Step 1: Run static verification**

```bash
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/eslint src/components/HomeView.tsx src/components/home src/components/__tests__/LibraryNavigation.test.tsx
./node_modules/.bin/vitest run --exclude '.pnpm-store/**' --exclude '.worktrees/**'
```

Expected: TypeScript exit 0, ESLint 0 errors, 985 or more tests PASS.

- [ ] **Step 2: Run the production build**

```bash
./node_modules/.bin/vite build
```

Expected: exit 0 and `horsehead-dormant-*.webp` emitted in `dist/assets`.

- [ ] **Step 3: Check the live page at desktop and 390px**

Start the dev server and verify:

- Desktop: no horizontal overflow; the Horsehead subject remains visible to the right of the hero; the hero, four capabilities, workflow, universe explanation, final CTA, and footer are reachable.
- 390px: one-column sections; all CTA labels fit; QA and settings remain reachable; fixed backdrop does not block scrolling.
- Reduced motion: emulate `prefers-reduced-motion: reduce`; sections are visible without translate animation.
- Populated data: landing disappears and the interactive knowledge universe still zooms and opens courses.
