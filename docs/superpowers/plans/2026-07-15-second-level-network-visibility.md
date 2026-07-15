# Second-Level Knowledge Network Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent a stale parent selection from dimming the entire second-level knowledge network and make unselected relationship arrows readable on the dark canvas.

**Architecture:** Keep `selectedNodeId` as the content-panel context, but derive a separate `canvasSelectedNodeId` that is valid only inside the currently displayed network. Pass that derived value to the SVG canvas, then calibrate only the no-selection edge opacity; do not change layout, data generation, or automatic selection behavior.

**Tech Stack:** React 18, TypeScript, Zustand, SVG, Tailwind CSS, Vitest, React DOM test utilities.

---

## File Map

- Modify `src/components/KnowledgeStructureView.tsx`: derive and pass the current-layer-only canvas selection.
- Modify `src/components/knowledge-network/KnowledgeNetworkCanvas.tsx`: raise the no-selection edge opacity.
- Modify `src/components/__tests__/KnowledgeStructureView.network.test.tsx`: reproduce the stale parent selection and verify the parent source context remains available.
- Modify `src/components/__tests__/KnowledgeNetworkCanvas.test.tsx`: lock the edge visibility and selected-neighborhood opacity rules.

### Task 1: Ignore a Parent Selection That Does Not Exist in the Current Network

**Files:**
- Modify: `src/components/KnowledgeStructureView.tsx:105-121,243-251`
- Test: `src/components/__tests__/KnowledgeStructureView.network.test.tsx:105-125`

- [ ] **Step 1: Write the failing regression test**

Extend `replaces the course graph with the selected topic graph and closes back to the course graph` immediately after locating the teaching node:

```tsx
const teaching = container.querySelector<SVGGElement>('[aria-label="概率模型案例"]')!;
const definition = container.querySelector<SVGGElement>('[aria-label="概率模型定义"]')!;

expect(teaching).not.toBeNull();
expect(definition).not.toBeNull();
expect(teaching.getAttribute('opacity')).toBe('1');
expect(definition.getAttribute('opacity')).toBe('1');
expect(container.textContent).toContain('课程原文：概率模型定义');
```

This reproduces the defect because the parent topic ID remains selected while neither teaching node has that ID.

- [ ] **Step 2: Run the regression test and verify RED**

Run:

```bash
./node_modules/.bin/vitest run src/components/__tests__/KnowledgeStructureView.network.test.tsx
```

Expected: FAIL because the teaching nodes currently have `opacity="0.32"` after entering the second-level network.

- [ ] **Step 3: Derive a current-network canvas selection**

In `KnowledgeStructureView`, immediately after `currentNetwork` is created, add:

```tsx
const canvasSelectedNodeId = selectedNodeId && currentNetwork.nodes.some(node => node.id === selectedNodeId)
  ? selectedNodeId
  : null;
```

Keep the existing `selectedNode` lookup unchanged so a parent topic can remain the source-panel context. Change only the canvas prop:

```tsx
<KnowledgeNetworkCanvas
  model={currentNetwork}
  selectedId={canvasSelectedNodeId}
  onSelect={selectNode}
  search={search}
  relationTypes={relationType === 'all' ? undefined : [relationType]}
/>
```

- [ ] **Step 4: Run the regression test and verify GREEN**

Run:

```bash
./node_modules/.bin/vitest run src/components/__tests__/KnowledgeStructureView.network.test.tsx
```

Expected: PASS; both second-level nodes have `opacity="1"`, and the parent topic source remains visible until a second-level node is selected.

- [ ] **Step 5: Commit the current-layer selection fix**

```bash
git add src/components/KnowledgeStructureView.tsx src/components/__tests__/KnowledgeStructureView.network.test.tsx
git commit -m "Fix second-level network selection state"
```

### Task 2: Make Unselected Relationship Arrows Readable

**Files:**
- Modify: `src/components/knowledge-network/KnowledgeNetworkCanvas.tsx:260-276`
- Test: `src/components/__tests__/KnowledgeNetworkCanvas.test.tsx:24-52`

- [ ] **Step 1: Write the failing edge-visibility test**

Add this test to `KnowledgeNetworkCanvas.test.tsx`:

```tsx
it('keeps unselected relationships readable without weakening normal nodes', () => {
  const rendered = renderCanvas();
  const edge = rendered.container.querySelector<SVGGElement>('[data-edge="r1"]')!;
  const first = rendered.container.querySelector<SVGGElement>('[data-node="t1"]')!;
  const second = rendered.container.querySelector<SVGGElement>('[data-node="t2"]')!;

  expect(edge.getAttribute('opacity')).toBe('0.34');
  expect(first.getAttribute('opacity')).toBe('1');
  expect(second.getAttribute('opacity')).toBe('1');
});
```

- [ ] **Step 2: Run the canvas test and verify RED**

Run:

```bash
./node_modules/.bin/vitest run src/components/__tests__/KnowledgeNetworkCanvas.test.tsx
```

Expected: FAIL because the edge currently has `opacity="0.2"` when nothing is selected.

- [ ] **Step 3: Raise only the no-selection edge opacity**

Change the edge group opacity expression in `KnowledgeNetworkCanvas.tsx`:

```tsx
<g key={edge.id} opacity={selectedId ? (connected ? 0.9 : 0.08) : 0.34} data-edge={edge.id}>
```

Do not change the selected-node palette, the `0.08` unrelated-edge state, or the node-neighborhood opacity expression.

- [ ] **Step 4: Run focused network tests and verify GREEN**

Run:

```bash
./node_modules/.bin/vitest run src/components/__tests__/KnowledgeNetworkCanvas.test.tsx src/components/__tests__/KnowledgeStructureView.network.test.tsx
```

Expected: both test files pass.

- [ ] **Step 5: Commit the relationship visibility calibration**

```bash
git add src/components/knowledge-network/KnowledgeNetworkCanvas.tsx src/components/__tests__/KnowledgeNetworkCanvas.test.tsx
git commit -m "Improve knowledge network edge visibility"
```

### Task 3: Full Verification

**Files:**
- Verify only; no production changes expected.

- [ ] **Step 1: Run the complete test suite**

```bash
./node_modules/.bin/vitest run --exclude '.pnpm-store/**' --exclude '.worktrees/**'
```

Expected: all test files and all tests pass with zero failures.

- [ ] **Step 2: Run TypeScript and production build checks**

```bash
./node_modules/.bin/tsc --noEmit
npm run build
```

Expected: both commands exit with status 0.

- [ ] **Step 3: Verify the live interaction**

In the running local app:

1. Open a course knowledge network.
2. Select an一级知识 node to enter its二级知识网.
3. Confirm all second-level nodes are fully visible and arrows are readable.
4. Confirm the right source panel initially still shows the parent topic source.
5. Select a second-level node and confirm only unrelated nodes and edges are weakened.
6. Collapse the second-level network and confirm the first-level network returns normally.

Expected: the second-level network is readable on entry, selection focus remains meaningful, and no navigation or source-panel behavior regresses.

- [ ] **Step 4: Inspect the final diff**

```bash
git diff --check
git status --short
```

Expected: no whitespace errors; only planned files or known pre-existing untracked paths are present.
