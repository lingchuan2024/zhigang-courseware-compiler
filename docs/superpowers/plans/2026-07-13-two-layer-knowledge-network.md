# Two-Layer Knowledge Network Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the V6 knowledge-structure list with a drill-down two-layer network whose selected nodes reveal their exact MinerU Markdown source on the right.

**Architecture:** Normalize course topics and teaching blocks into one graph-view model, render both layers with one reusable SVG canvas, and resolve `SourceRange[]` through a pure source resolver used by a dedicated evidence panel. `KnowledgeStructureView` owns navigation state but the canvas, adapters, and source panel remain store-independent.

**Tech Stack:** React 18, TypeScript, Zustand, SVG, Tailwind CSS, Vitest, existing MarkdownRenderer.

---

### Task 1: Resolve source ranges to exact Markdown

**Files:**
- Create: `src/lib/source-range-resolver.ts`
- Create: `src/lib/__tests__/source-range-resolver.test.ts`

- [ ] **Step 1: Write failing tests** for a valid continuous range, multiple non-contiguous ranges, and a missing block ID. The tests call `resolveSourceRanges(ranges, documents)` and assert ordered blocks, Markdown content, heading path, and `missingReason`.
- [ ] **Step 2: Run `npx vitest run src/lib/__tests__/source-range-resolver.test.ts`** and confirm the module or expected behavior is missing.
- [ ] **Step 3: Implement the pure resolver** with these public shapes:

```ts
export interface ResolvedSourceRange {
  range: SourceRange;
  documentTitle: string;
  headingPath: string[];
  blocks: MarkdownBlock[];
  markdown: string;
  missingReason?: string;
}

export function resolveSourceRanges(
  ranges: SourceRange[],
  documents: SourceDocument[],
): ResolvedSourceRange[];
```

- [ ] **Step 4: Re-run the focused tests** and confirm they pass.

### Task 2: Adapt both knowledge layers into one graph model

**Files:**
- Create: `src/lib/knowledge-network-adapter.ts`
- Create: `src/lib/__tests__/knowledge-network-adapter.test.ts`

- [ ] **Step 1: Write failing tests** proving that all valid topic/teaching relations become edges, invalid relation endpoints produce warnings, and recommended paths are separate overlay edges.
- [ ] **Step 2: Run `npx vitest run src/lib/__tests__/knowledge-network-adapter.test.ts`** and confirm failure for the missing adapter.
- [ ] **Step 3: Implement `KnowledgeNetworkNode`, `KnowledgeNetworkEdge`, `KnowledgeNetworkModel`, `buildCourseNetwork`, and `buildTeachingNetwork`.** Both builders preserve `sourceRanges`; neither replaces original edges with path edges.
- [ ] **Step 4: Re-run the adapter tests** and confirm they pass.

### Task 3: Add a reusable network layout and SVG canvas

**Files:**
- Create: `src/lib/knowledge-network-layout.ts`
- Create: `src/lib/__tests__/knowledge-network-layout.test.ts`
- Create: `src/components/knowledge-network/KnowledgeNetworkCanvas.tsx`
- Create: `src/components/__tests__/KnowledgeNetworkCanvas.test.tsx`

- [ ] **Step 1: Write failing layout tests** for finite, non-overlapping node positions and prerequisite edges flowing left-to-right.
- [ ] **Step 2: Write failing component tests** for node selection, double-click drill-down, and keyboard Enter selection.
- [ ] **Step 3: Run both focused test files** and confirm missing behavior.
- [ ] **Step 4: Implement a deterministic layered/grid layout** accepting only generic graph nodes and edges.
- [ ] **Step 5: Implement the SVG canvas** with arrows, selected-neighborhood fading, pan, wheel zoom, fit-to-view, relation legend, path overlay, empty-relation notice, and accessible node buttons through SVG `tabIndex`/keyboard handlers.
- [ ] **Step 6: Re-run the layout and component tests** and confirm they pass.

### Task 4: Add the right-side original-source panel

**Files:**
- Create: `src/components/knowledge-network/SourceEvidencePanel.tsx`
- Create: `src/components/__tests__/SourceEvidencePanel.test.tsx`

- [ ] **Step 1: Write failing tests** for rendered source, raw Markdown switching, separate range cards, and a missing-source warning that does not display an AI summary.
- [ ] **Step 2: Run `npx vitest run src/components/__tests__/SourceEvidencePanel.test.tsx`** and confirm failure.
- [ ] **Step 3: Implement the panel** using `resolveSourceRanges`, `MarkdownRenderer`, a 360px desktop width, collapsible state, and safe empty/missing-source states.
- [ ] **Step 4: Re-run the focused panel tests** and confirm they pass.

### Task 5: Replace the V6 list view with drill-down networks

**Files:**
- Modify: `src/components/KnowledgeStructureView.tsx`
- Create: `src/components/__tests__/KnowledgeStructureView.network.test.tsx`

- [ ] **Step 1: Write failing integration tests** asserting the default course network, topic click source panel, internal-network drill-down, second-layer source display, and breadcrumb return.
- [ ] **Step 2: Run the focused integration test** and confirm the existing list view fails the network expectations.
- [ ] **Step 3: Rebuild `KnowledgeStructureView`** around `layer`, `selectedTopicId`, `selectedNodeId`, search, relation filter, and path-overlay state. Keep existing running/blocked/failed states and the notes navigation button.
- [ ] **Step 4: Re-run the integration test** and confirm it passes.

### Task 6: Verify the complete application

**Files:**
- Verify all files above without unrelated edits.

- [ ] **Step 1: Run focused network tests** and confirm all pass.
- [ ] **Step 2: Run `npm test -- --run`** and confirm zero failures.
- [ ] **Step 3: Run `npm run check`** and confirm zero TypeScript errors.
- [ ] **Step 4: Run `npm run build`** and confirm a successful production build.
- [ ] **Step 5: Run `npm run lint`** and confirm zero new errors.
- [ ] **Step 6: Run `git diff --check` and a generic secret scan** and confirm clean output.
- [ ] **Step 7: Inspect the local UI** to verify a visible first-layer network, drill-down second layer, breadcrumb return, and right-side source panel.
