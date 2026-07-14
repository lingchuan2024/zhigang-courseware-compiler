# Clear Expanded Knowledge Subnetwork Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the first-layer course network and the expanded second-layer network immediately distinguishable, with an `×` control attached to the second-layer region itself.

**Architecture:** Extend the normalized network model with one optional expanded-group descriptor. The generic SVG canvas computes a padded bounding box for that group, renders the group background and close control, and delegates closing to `KnowledgeStructureView`; no graph data is deleted.

**Tech Stack:** React 18, TypeScript, SVG, Tailwind CSS, Vitest/JSDOM.

---

### Task 1: Describe the expanded subnet in the graph model

**Files:**
- Modify: `src/lib/knowledge-network-adapter.ts`
- Modify: `src/lib/__tests__/knowledge-network-adapter.test.ts`

- [ ] **Step 1: Write the failing adapter test**

Add an assertion that `buildExpandedKnowledgeNetwork` returns the internal node IDs and topic label as a separate group:

```ts
expect(expanded.expandedGroup).toEqual({
  topicId: 'topic-glm',
  label: '广义线性模型 · 内部知识网',
  nodeIds: ['block-family', 'block-formula'],
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm test -- src/lib/__tests__/knowledge-network-adapter.test.ts`

Expected: FAIL because `expandedGroup` does not exist.

- [ ] **Step 3: Add the minimal model field**

```ts
export interface ExpandedNetworkGroup {
  topicId: string;
  label: string;
  nodeIds: string[];
}

export interface KnowledgeNetworkModel {
  // existing fields
  expandedGroup?: ExpandedNetworkGroup;
}
```

Populate it in `buildExpandedKnowledgeNetwork` from the selected topic node and teaching nodes.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `npm test -- src/lib/__tests__/knowledge-network-adapter.test.ts`

Expected: PASS.

### Task 2: Render the subnet region and its own close control

**Files:**
- Modify: `src/components/knowledge-network/KnowledgeNetworkCanvas.tsx`
- Modify: `src/components/__tests__/KnowledgeNetworkCanvas.test.tsx`

- [ ] **Step 1: Write the failing canvas tests**

Render a model with `expandedGroup`, pass `onCollapseExpandedGroup`, then assert:

```ts
expect(container.querySelector('[data-testid="expanded-network-group"]')).not.toBeNull();
const close = container.querySelector('[aria-label="收起内部知识网"]')!;
act(() => close.dispatchEvent(new MouseEvent('click', { bubbles: true })));
expect(onCollapse).toHaveBeenCalledOnce();
```

Also assert first-layer and second-layer nodes expose distinct `data-network-layer` values.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm test -- src/components/__tests__/KnowledgeNetworkCanvas.test.tsx`

Expected: FAIL because the group and canvas callback do not exist.

- [ ] **Step 3: Implement the group bounds helper**

Add a pure helper that reads positions for `expandedGroup.nodeIds` and returns a padded rectangle. Return `null` when no valid positions exist.

- [ ] **Step 4: Render the visual group behind edges and nodes**

Render an SVG `<g data-testid="expanded-network-group">` containing:

```tsx
<rect rx={28} fill="#edf4ef" fillOpacity={0.86} stroke="#7da99a" />
<text>{model.expandedGroup.label}</text>
<g role="button" aria-label="收起内部知识网" tabIndex={0}>...</g>
```

The close control handles click, Enter, and Space without selecting the underlying graph node.

- [ ] **Step 5: Strengthen layer styling**

Give topic nodes `data-network-layer="course"`, larger dimensions, dark green styling and integer numbers. Give teaching nodes `data-network-layer="internal"`, smaller light styling and display `${parentSequence}.${node.sequence}` through adapter metadata.

- [ ] **Step 6: Run the focused test and verify GREEN**

Run: `npm test -- src/components/__tests__/KnowledgeNetworkCanvas.test.tsx`

Expected: PASS.

### Task 3: Move collapse interaction out of the global header

**Files:**
- Modify: `src/components/KnowledgeStructureView.tsx`
- Modify: `src/components/__tests__/KnowledgeStructureView.network.test.tsx`

- [ ] **Step 1: Change the integration test to require the in-canvas close control**

Assert there is no header button containing `× 收起内部网`, then click `[aria-label="收起内部知识网"]` inside the canvas and verify teaching nodes disappear while the selected course node remains.

- [ ] **Step 2: Run the integration test and verify RED**

Run: `npm test -- src/components/__tests__/KnowledgeStructureView.network.test.tsx`

Expected: FAIL because closing still lives in the header.

- [ ] **Step 3: Wire the canvas callback**

Remove the header collapse button and pass:

```tsx
<KnowledgeNetworkCanvas
  ...
  onCollapseExpandedGroup={expandedTopicId ? collapseTeachingNetwork : undefined}
/>
```

Keep the empty-subnet fallback button because no group can be drawn without nodes.

- [ ] **Step 4: Run the integration test and verify GREEN**

Run: `npm test -- src/components/__tests__/KnowledgeStructureView.network.test.tsx`

Expected: PASS.

- [ ] **Step 5: Run the network regression set**

Run: `npm test -- src/lib/__tests__/knowledge-network-adapter.test.ts src/lib/__tests__/knowledge-network-layout.test.ts src/components/__tests__/KnowledgeNetworkCanvas.test.tsx src/components/__tests__/KnowledgeStructureView.network.test.tsx`

Expected: all tests PASS.
