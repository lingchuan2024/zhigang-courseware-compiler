# Deep Knowledge Cards, Continuous Notes, and Library Deletion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate substantial evidence-grounded knowledge cards, present the assembled course note as one continuously scrollable document, and support safe cascading deletion of documents and courses.

**Architecture:** Add a deterministic card-quality boundary in front of the existing enrichment pipeline, strengthen the stable model prompts without sending the full courseware, and keep `TopicSynthesis` as the bridge from cards to chapters. Render the existing assembled `CourseMasterNote.markdown` as the primary document with anchor navigation. Put all deletion invariants in `library-repository.ts`, expose them through the Zustand library store, and keep confirmation state in the library UI.

**Tech Stack:** TypeScript, React 18, Zustand, IndexedDB, Vitest, React DOM test utilities, Tailwind CSS, existing Markdown/KaTeX renderer.

---

## File map

- Create `src/lib/card-quality.ts`: deterministic card-quality rules and actionable failure reasons.
- Create `src/lib/__tests__/card-quality.test.ts`: quality rules for placeholders, comparisons, derivations, evidence, and AI supplements.
- Modify `src/lib/card-enrichment.ts`: richer stable prompt, controlled sibling context, quality-gated retry, and stable fallback behavior.
- Modify `src/lib/__tests__/knowledge-pipeline-v2-cards.test.ts`: integration assertions for enriched Markdown and deep-card output.
- Modify `src/lib/master-note-generator.ts`: stronger synthesis/chapter contracts for overview, parallel knowledge, complete derivations, and supplement labels.
- Modify `src/lib/__tests__/master-note-generator.test.ts`: verify second-layer order and pedagogical contracts reach model requests.
- Modify `src/lib/course-master-note.ts`: assemble overview, framework, every usable chapter, and explicit failed-chapter placeholders into one document.
- Modify `src/lib/__tests__/course-master-note.test.ts`: verify complete continuous output and partial chapter placement.
- Modify `src/components/MasterNoteView.tsx`: display the full note, anchor-scroll from the directory, highlight visible sections, and retry failed chapters in place.
- Modify `src/components/__tests__/NotesView.v2.test.tsx`: verify full-note rendering and non-replacing directory navigation.
- Modify `src/lib/library-repository.ts`: transactional document/course cascade deletion for IndexedDB and the memory fallback.
- Modify `src/lib/__tests__/library-repository.test.ts`: verify deletion scope and retained chat history.
- Modify `src/store/useLibraryStore.ts`: store actions and active-course recovery after deletion.
- Modify `src/components/LibraryView.tsx`: document/course delete controls and confirmation dialogs.
- Modify `src/components/__tests__/LibraryNavigation.test.tsx`: verify user-facing deletion flow.

### Task 1: Deterministic knowledge-card quality gate

**Files:**
- Create: `src/lib/card-quality.ts`
- Create: `src/lib/__tests__/card-quality.test.ts`

- [ ] **Step 1: Write failing tests for shallow and complete cards**

```ts
import { describe, expect, it } from 'vitest';
import { evaluateKnowledgeCardDraft } from '../card-quality';

describe('knowledge card quality', () => {
  it('rejects generic comparison placeholders', () => {
    const result = evaluateKnowledgeCardDraft({
      teachingType: 'comparison',
      detailedNote: '表格可能包含各方法的特点、适用场景等对比信息。',
      sourceRangeCount: 1,
    });
    expect(result.accepted).toBe(false);
    expect(result.reasons).toContain('正文包含空泛占位表达');
  });

  it('requires a derivation to expose explicit steps', () => {
    const result = evaluateKnowledgeCardDraft({
      teachingType: 'derivation',
      detailedNote: '由上式直接得到最终结论。',
      sourceRangeCount: 2,
    });
    expect(result.reasons).toContain('推导缺少可检查的连续步骤');
  });

  it('accepts a concrete comparison with dimensions and conclusions', () => {
    const result = evaluateKnowledgeCardDraft({
      teachingType: 'comparison',
      detailedNote: '## 比较对象\n\nPCA 与 NMF 都用于降维。\n\n| 维度 | PCA | NMF |\n|---|---|---|\n| 约束 | 正交 | 非负 |\n| 可解释性 | 主成分 | 部件表示 |\n\n因此非负数据强调部件解释时优先考虑 NMF。',
      sourceRangeCount: 2,
    });
    expect(result).toEqual({ accepted: true, reasons: [] });
  });
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `pnpm exec vitest run src/lib/__tests__/card-quality.test.ts`

Expected: FAIL because `../card-quality` does not exist.

- [ ] **Step 3: Implement the quality evaluator**

```ts
export interface KnowledgeCardDraftQualityInput {
  teachingType: string;
  detailedNote: string;
  sourceRangeCount: number;
}

export interface KnowledgeCardQualityResult {
  accepted: boolean;
  reasons: string[];
}

const PLACEHOLDERS = [
  /可能包含/,
  /可能包括/,
  /可从以下方面/,
  /可以介绍/,
  /等对比信息/,
];

export function evaluateKnowledgeCardDraft(input: KnowledgeCardDraftQualityInput): KnowledgeCardQualityResult {
  const text = input.detailedNote.trim();
  const reasons: string[] = [];
  if (text.length < 120) reasons.push('正文过短，尚未形成可独立学习的讲解');
  if (PLACEHOLDERS.some(pattern => pattern.test(text))) reasons.push('正文包含空泛占位表达');
  if (input.sourceRangeCount === 0 && !text.includes('证据不足')) reasons.push('缺少课件证据说明');
  if (/derivation|推导|formula-system/.test(input.teachingType)) {
    const stepSignals = text.match(/(?:步骤\s*\d+|第[一二三四五六七八九十]+步|\n\s*\d+[.、)])/g) ?? [];
    if (stepSignals.length < 2) reasons.push('推导缺少可检查的连续步骤');
  }
  if (/comparison|对比|分类/.test(input.teachingType)) {
    const tableRows = text.split('\n').filter(line => /^\s*\|.*\|\s*$/.test(line));
    if (tableRows.length < 4) reasons.push('对比缺少明确对象和比较维度');
  }
  return { accepted: reasons.length === 0, reasons };
}
```

- [ ] **Step 4: Run the focused test and adjust only deterministic thresholds if needed**

Run: `pnpm exec vitest run src/lib/__tests__/card-quality.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the quality boundary**

```bash
git add src/lib/card-quality.ts src/lib/__tests__/card-quality.test.ts
git commit -m "Add knowledge card quality gate"
```

### Task 2: Rich card context and quality-gated enrichment

**Files:**
- Modify: `src/lib/card-enrichment.ts`
- Modify: `src/lib/__tests__/knowledge-pipeline-v2-cards.test.ts`

- [ ] **Step 1: Add a failing integration test for the prompt contract and rejected shallow output**

Extend the existing mocked model test so the captured request must contain the current topic, sibling directory, one-hop relations, source evidence, type-specific instructions, and the exact supplement label. Return a shallow comparison on the first call and a concrete table on the second call, then assert two calls occurred and the final card is `completed`.

```ts
expect(capturedSystem).toContain('对比类');
expect(capturedSystem).toContain('AI 教学补充');
expect(capturedUser).toContain('同级二级知识目录');
expect(capturedUser).toContain('一跳关系');
expect(model).toHaveBeenCalledTimes(2);
expect(result.knowledgeCards[0].status).toBe('completed');
```

- [ ] **Step 2: Run the card pipeline test and verify the new assertions fail**

Run: `pnpm exec vitest run src/lib/__tests__/knowledge-pipeline-v2-cards.test.ts`

Expected: FAIL because the prompt is still V1 and there is no quality retry.

- [ ] **Step 3: Build the controlled context and stable V2 prompt**

In `buildPrompt`, add a sibling summary sorted by `narrativeIndex`, keep the one-hop relation list stable, and use the following contract in the stable system prefix:

```ts
const system = `你是一位严谨的课程知识卡片作者。知识卡片必须是可独立学习的知识原料包，而不是笔记片段或写作建议。

按知识类型自然组织：
- 概念类：位置、直觉、正式定义、性质、边界、误区。
- 推导类：假设、符号、起点、至少两个连续步骤、结论、含义、成立条件。
- 方法类：问题、直觉、步骤、代价、适用条件、例子。
- 对比类：真实比较对象、共同目标、至少两个维度、Markdown 对比表、选择建议。
- 分类类：分类依据、各分支特点、联系和选择地图。

禁止输出“可能包含”“可能包括”“可从以下方面介绍”等占位文字。
课件之外的通用教材解释必须放在：
> AI 教学补充：以下内容用于补足课件省略的解释或推导，不属于课件原文。

只返回 JSON：{ conciseSummary, detailedNote, keyPoints, applicableConditions, examples, misconceptions, selfCheckQuestions }。`;
```

The dynamic input must remain bounded: direct source blocks, sibling titles/summaries only, and one-hop relations only. Set `promptVersion` to `knowledge-card-enrichment-v2`.

- [ ] **Step 4: Evaluate the generated draft and retry once with reasons**

Call `evaluateKnowledgeCardDraft` after Markdown preparation. If rejected, make one second completion call using the same stable prefix plus a dynamic repair section:

```ts
`上一次结果未通过质量检查：${quality.reasons.join('；')}。请重写整张卡片，不要解释检查规则。`
```

Do not replace an existing completed card with a failed retry. Return `partial` only when no usable previous version exists.

- [ ] **Step 5: Run card tests and commit**

Run: `pnpm exec vitest run src/lib/__tests__/card-quality.test.ts src/lib/__tests__/knowledge-pipeline-v2-cards.test.ts src/components/__tests__/KnowledgeCardsView.test.tsx`

Expected: PASS.

```bash
git add src/lib/card-enrichment.ts src/lib/__tests__/knowledge-pipeline-v2-cards.test.ts
git commit -m "Deepen evidence grounded knowledge cards"
```

### Task 3: Pedagogical synthesis and full-note assembly

**Files:**
- Modify: `src/lib/master-note-generator.ts`
- Modify: `src/lib/course-master-note.ts`
- Modify: `src/lib/__tests__/master-note-generator.test.ts`
- Modify: `src/lib/__tests__/course-master-note.test.ts`

- [ ] **Step 1: Add failing prompt and assembly tests**

Add assertions that synthesis requests contain the complete ordered card material and explicitly request parallel grouping and derivation chains, while chapter requests require a chapter map before dense material. Add an assembly test with one completed and one failed chapter:

```ts
expect(chapterRequest.system).toContain('先给出本章知识框架');
expect(chapterRequest.system).toContain('AI 教学补充');
expect(synthesisRequest.system).toContain('不得把知识卡片机械拼接');

const note = assembleCourseMasterNote({ /* one completed, one failed */ });
expect(note.markdown).toContain('## 课程概述');
expect(note.markdown).toContain('第一章正文');
expect(note.markdown).toContain('第二章生成失败');
```

- [ ] **Step 2: Run generator and assembler tests and verify failure**

Run: `pnpm exec vitest run src/lib/__tests__/master-note-generator.test.ts src/lib/__tests__/course-master-note.test.ts`

Expected: FAIL on the new prompt and course-overview assertions.

- [ ] **Step 3: Strengthen the stable generation contracts**

Update `SYNTHESIS_SYSTEM` to require reordered teaching material, duplicate removal, `parallelGroups`, `comparisons`, and formula chains with assumptions/steps/conclusion/conditions. Update `CHAPTER_PLAN_SYSTEM` to produce a course-level learning arc. Update `CHAPTER_NOTE_SYSTEM` to require:

```text
1. 知识密集章节先给出本章知识框架。
2. 并列知识先总结共同目标和分类依据，再比较差异与选择条件。
3. 推导写出假设、符号、起点、连续步骤、结论和适用条件。
4. 课件外内容必须使用统一的 AI 教学补充引用块。
5. 不得把知识卡片按标题机械拼接。
```

Keep the existing bounded contexts: one topic's cards for synthesis, concise synthesis summaries for planning, and only the chapter's syntheses for chapter writing.

- [ ] **Step 4: Assemble one complete document with explicit partial positions**

Build the final Markdown in this order:

```ts
const overview = [
  '## 课程概述',
  `本课程围绕 ${input.outline.map(chapter => chapter.title).join('、')} 展开。`,
  '## 课程框架',
  framework,
].join('\n\n');

const body = chapters.map(chapter =>
  chapter.status === 'completed' && chapter.markdown.trim()
    ? dedupeAdjacentMarkdown(chapter.markdown)
    : `## ${chapter.title}\n\n> 本章生成失败：${chapter.error ?? '尚未生成'}\n\n[重新生成本章]`
).join('\n\n---\n\n');
```

Only completed chapters count toward coverage. Failed placeholders make the location visible but do not become generated knowledge.

- [ ] **Step 5: Run tests and commit**

Run: `pnpm exec vitest run src/lib/__tests__/master-note-generator.test.ts src/lib/__tests__/course-master-note.test.ts src/store/__tests__/master-note-generation.test.ts`

Expected: PASS.

```bash
git add src/lib/master-note-generator.ts src/lib/course-master-note.ts src/lib/__tests__/master-note-generator.test.ts src/lib/__tests__/course-master-note.test.ts
git commit -m "Generate pedagogical continuous course notes"
```

### Task 4: Continuous full-note reader with anchor navigation

**Files:**
- Modify: `src/components/MasterNoteView.tsx`
- Modify: `src/components/__tests__/NotesView.v2.test.tsx`

- [ ] **Step 1: Write a failing UI test that both chapters remain in the DOM**

Seed two completed chapters and a `CourseMasterNote.markdown` containing both. Click the second directory item and assert the first chapter remains visible while `scrollIntoView` is called for the second anchor.

```ts
const scrollIntoView = vi.fn();
Element.prototype.scrollIntoView = scrollIntoView;
expect(container.textContent).toContain('第一章正文');
expect(container.textContent).toContain('第二章正文');
act(() => button('第二章').click());
expect(scrollIntoView).toHaveBeenCalled();
expect(container.textContent).toContain('第一章正文');
```

- [ ] **Step 2: Run the UI test and verify current chapter replacement fails it**

Run: `pnpm exec vitest run src/components/__tests__/NotesView.v2.test.tsx`

Expected: FAIL because `displayMarkdown` currently selects only `activeChapter.markdown`.

- [ ] **Step 3: Render the assembled full Markdown as the primary document**

Remove chapter-selected `displayMarkdown` behavior. When `masterNote.markdown` is usable, render a document wrapper containing the full Markdown. Before rendering, insert stable chapter anchors based on plan IDs or wrap each chapter in a `section` with `id={\`note-${chapter.id}\`}` while preserving one vertical scroll container.

Directory click behavior becomes:

```ts
const jumpToChapter = (chapterId: string) => {
  setActiveChapterId(chapterId);
  document.getElementById(`note-${chapterId}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
};
```

- [ ] **Step 4: Keep failed chapter retry in place, highlight visible sections, and move evidence to a drawer**

Render each chapter section in order so failed chapters have their own error panel and retry button. Attach one `IntersectionObserver` to section elements; when a section becomes the most visible, update `activeChapterId`. Remove the permanently visible right evidence rail and add a “查看本章依据” button that opens a dismissible drawer populated from the highlighted chapter's `sourceCardIds`; the drawer must never control or replace the body content.

- [ ] **Step 5: Run UI tests and commit**

Run: `pnpm exec vitest run src/components/__tests__/NotesView.v2.test.tsx src/components/__tests__/KnowledgeCardsView.test.tsx`

Expected: PASS.

```bash
git add src/components/MasterNoteView.tsx src/components/__tests__/NotesView.v2.test.tsx
git commit -m "Show complete notes in a continuous reader"
```

### Task 5: Transactional document and course cascade deletion

**Files:**
- Modify: `src/lib/library-repository.ts`
- Modify: `src/lib/__tests__/library-repository.test.ts`

- [ ] **Step 1: Add failing repository tests for both cascade levels**

Create two courses, multiple documents, snapshots, retrieval records, and a chat conversation. After deleting one document, assert its metadata/snapshot/retrieval disappear and the parent course loses only that ID. After deleting one course, assert all of its documents and derived records disappear while the other course and chat remain.

```ts
await deleteLibraryDocumentCascade('doc-1');
expect(await loadLibraryProjectSnapshot('doc-1')).toBeNull();
expect((await listRetrievalRecords()).some(item => item.documentId === 'doc-1')).toBe(false);
expect((await listLibraryCourses()).find(item => item.id === course.id)?.documentIds).toEqual(['doc-2']);

await deleteLibraryCourseCascade(course.id);
expect((await listLibraryDocuments()).some(item => item.courseId === course.id)).toBe(false);
expect((await listChatConversations()).map(item => item.id)).toContain('history');
```

- [ ] **Step 2: Run repository tests and verify missing exports**

Run: `pnpm exec vitest run src/lib/__tests__/library-repository.test.ts`

Expected: FAIL because cascade functions do not exist.

- [ ] **Step 3: Implement memory fallback deletion**

For `deleteLibraryDocumentCascade`, delete the document, snapshot, and retrieval records, then rewrite the parent course's `documentIds`. For `deleteLibraryCourseCascade`, collect the course's document IDs first, delete all their documents/snapshots/retrieval records, then delete the course. Never touch conversation/message maps.

- [ ] **Step 4: Implement one IndexedDB readwrite transaction per operation**

Use `[COURSES, DOCUMENTS, SNAPSHOTS, RETRIEVAL]` in a single transaction. Query retrieval records by `documentId` for document deletion and by `courseId` for course deletion, delete all collected keys, update/delete the course, then await `transactionDone(tx)`.

- [ ] **Step 5: Run tests and commit**

Run: `pnpm exec vitest run src/lib/__tests__/library-repository.test.ts src/lib/__tests__/card-retrieval.test.ts`

Expected: PASS.

```bash
git add src/lib/library-repository.ts src/lib/__tests__/library-repository.test.ts
git commit -m "Add courseware cascade deletion"
```

### Task 6: Library deletion interactions and final verification

**Files:**
- Modify: `src/store/useLibraryStore.ts`
- Modify: `src/components/LibraryView.tsx`
- Modify: `src/components/__tests__/LibraryNavigation.test.tsx`

- [ ] **Step 1: Add a failing user-flow test**

Seed a course with a document, render the library, click “删除课件”, confirm, and assert it disappears. Then delete an empty course and assert the store selects another course or `null`.

```ts
await act(async () => button('删除课件').click());
expect(container!.textContent).toContain('同时删除 MinerU 解析、知识结构、知识卡片、完整笔记和检索索引');
await act(async () => button('确认删除课件').click());
expect(container!.textContent).not.toContain('lecture1.pdf');
```

- [ ] **Step 2: Run the navigation test and verify deletion controls are absent**

Run: `pnpm exec vitest run src/components/__tests__/LibraryNavigation.test.tsx`

Expected: FAIL because the store and view expose no deletion actions.

- [ ] **Step 3: Add store actions with recovery semantics**

Add these members to `LibraryState`:

```ts
deleteDocument: (documentId: string) => Promise<void>;
deleteCourse: (courseId: string) => Promise<void>;
```

Each action calls the matching repository cascade, reloads courses/documents, and chooses `activeCourseId` from the surviving courses when the active course is removed. On failure, keep the current UI data and set a readable `error`.

- [ ] **Step 4: Add compact menu actions and explicit confirmation dialogs**

Use separate click targets so opening a document never also triggers delete. The document confirmation copy lists parsed Markdown, networks, cards, notes, and index. The course confirmation includes the number of contained documents. Disable confirm buttons while deletion is in progress and close the dialog only after success.

- [ ] **Step 5: Run the targeted suite**

Run: `pnpm exec vitest run src/components/__tests__/LibraryNavigation.test.tsx src/lib/__tests__/library-repository.test.ts src/components/__tests__/NotesView.v2.test.tsx src/lib/__tests__/master-note-generator.test.ts src/lib/__tests__/card-quality.test.ts src/lib/__tests__/knowledge-pipeline-v2-cards.test.ts`

Expected: PASS.

- [ ] **Step 6: Run project verification**

Run: `pnpm check`

Expected: TypeScript exits with code 0.

Run: `pnpm build`

Expected: Vite production build succeeds.

Run: `pnpm exec vitest run src vite`

Expected: all project-owned test files pass without scanning `.pnpm-store`.

- [ ] **Step 7: Commit the UI and store integration**

```bash
git add src/store/useLibraryStore.ts src/components/LibraryView.tsx src/components/__tests__/LibraryNavigation.test.tsx
git commit -m "Add safe deletion controls to course library"
```

## Execution order and checkpoints

1. Finish Tasks 1–2 and verify a shallow card is rejected and repaired.
2. Finish Tasks 3–4 and verify the note is one continuous document.
3. Finish Tasks 5–6 and verify both deletion levels preserve unrelated courses and chat history.
4. Run full verification before reporting completion.

Existing uncommitted changes in `KnowledgeCardsView.tsx`, its tests, `knowledge-pipeline-v2-cards.test.ts`, `card-enrichment.ts`, and `generated-markdown.ts` belong to the user/current feature and must be preserved. Stage only files intentionally changed by each task.
