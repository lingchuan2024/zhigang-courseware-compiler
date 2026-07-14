# Knowledge Cards and Course Master Notes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn existing per-block content into a visible knowledge-card stage, then generate evidence-backed topic syntheses, chapter notes, and one complete course master note with partial failure recovery.

**Architecture:** Structure extraction stops after the two-layer graph and local knowledge cards. A separate note pipeline consumes versioned cards, creates topic syntheses and a chapter plan, generates each chapter independently, and deterministically assembles the course master note only when non-empty completed chapters are available.

**Tech Stack:** React 18, TypeScript, Zustand, existing OpenAI-compatible model client, Markdown/KaTeX renderer, Vitest/JSDOM, localStorage persistence.

---

### Task 1: Add the six-stage workflow and master-note state types

**Files:**
- Modify: `src/types/index.ts`
- Modify: `src/lib/workflow-navigation.ts`
- Modify: `src/lib/__tests__/workflow-navigation.test.ts`
- Modify: `src/lib/persistence.ts`
- Modify: `src/lib/__tests__/persistence-migration.test.ts`

- [ ] **Step 1: Write failing workflow tests**

Assert the stage order and labels are:

```ts
expect(PRODUCT_STAGES).toEqual([
  'upload', 'document', 'mineru', 'structure', 'cards', 'notes',
]);
expect(STAGE_LABELS.cards).toBe('知识卡片');
expect(STAGE_LABELS.notes).toBe('完整笔记');
```

Assert `cards` is complete only when non-empty knowledge cards exist, and `notes` is complete only when the course master note is completed and contains non-whitespace Markdown.

- [ ] **Step 2: Run workflow tests and verify RED**

Run: `npm test -- src/lib/__tests__/workflow-navigation.test.ts`

Expected: FAIL because `cards` and master-note state do not exist.

- [ ] **Step 3: Add the data contracts**

Add:

```ts
export type ProductStage = 'upload' | 'document' | 'mineru' | 'structure' | 'cards' | 'notes';
export type GenerationStatus = 'pending' | 'generating' | 'partial' | 'completed' | 'stale' | 'failed';

export interface TopicSynthesis {
  id: string;
  topicId: string;
  framework: string[];
  orderedCardIds: string[];
  parallelGroups: Array<{ title: string; cardIds: string[]; summary: string }>;
  comparisons: Array<{ title: string; dimensions: string[]; rows: string[][] }>;
  formulaChains: Array<{ title: string; cardIds: string[]; explanation: string }>;
  markdown: string;
  cardVersions: Record<string, number>;
  status: GenerationStatus;
  error?: string;
}

export interface ChapterPlanItem {
  id: string;
  title: string;
  objective: string;
  topicIds: string[];
  framework: string[];
}

export interface ChapterNote extends ChapterPlanItem {
  markdown: string;
  sourceCardIds: string[];
  status: GenerationStatus;
  error?: string;
  retryCount: number;
}

export interface CourseMasterNote {
  id: string;
  title: string;
  outline: ChapterPlanItem[];
  chapters: ChapterNote[];
  glossary: GlossaryItem[];
  formulaIndex: FormulaCard[];
  markdown: string;
  coverage: { totalCardIds: string[]; coveredCardIds: string[]; missingCardIds: string[] };
  status: GenerationStatus;
  generatedFromStructureVersion: number;
  error?: string;
}
```

Add `topicSyntheses`, `chapterPlan`, `chapterNotes`, and `courseMasterNote` to `ProjectState` and optional snapshot fields.

- [ ] **Step 4: Implement six-stage derivation and migration defaults**

Persist the new fields. Old `notes` projects with V2 `topicNotes` but no master note migrate to `cards`; their existing content remains stored but is not considered a completed master note.

- [ ] **Step 5: Run workflow and persistence tests and verify GREEN**

Run: `npm test -- src/lib/__tests__/workflow-navigation.test.ts src/lib/__tests__/persistence-migration.test.ts`

Expected: PASS.

### Task 2: Stop generating topic notes during structure extraction

**Files:**
- Modify: `src/lib/knowledge-pipeline-v2.ts`
- Modify: `src/lib/__tests__/knowledge-pipeline-ai.test.ts`

- [ ] **Step 1: Write a failing pipeline test**

Assert a successful structure pipeline returns cards, leaves `topicNotes` empty, never reports `note-generation`, and still reaches validation/ready.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm test -- src/lib/__tests__/knowledge-pipeline-ai.test.ts`

Expected: FAIL because the structure pipeline currently calls `generateAllNotes`.

- [ ] **Step 3: Remove note generation from the structure pipeline**

Keep `generateCards`, set `topicNotes`, glossary and formula outputs to empty compatibility arrays, and validate structural coverage without requiring generated notes. Update the stage comment from “Card and Note Generation” to “Knowledge Card Generation”.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `npm test -- src/lib/__tests__/knowledge-pipeline-ai.test.ts`

Expected: PASS.

### Task 3: Add pure chapter planning, assembly, and completion guards

**Files:**
- Create: `src/lib/course-master-note.ts`
- Create: `src/lib/__tests__/course-master-note.test.ts`

- [ ] **Step 1: Write failing pure-function tests**

Cover these behaviors:

```ts
expect(isCompletedMasterNote({ status: 'completed', markdown: '   ' }, 3)).toBe(false);
expect(planFallbackChapters(topics, orderedIds, 4).flatMap(c => c.topicIds)).toEqual(orderedIds);
expect(assembleCourseMasterNote(input).coverage.missingCardIds).toEqual(['card-uncovered']);
expect(assembleCourseMasterNote(input).markdown).toContain('# 课程名称');
```

Also assert a failed chapter produces `partial`, preserves completed chapters, and does not disappear from the outline.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm test -- src/lib/__tests__/course-master-note.test.ts`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement deterministic fallbacks and assembly**

Export:

```ts
export function planFallbackChapters(...): ChapterPlanItem[];
export function assembleCourseMasterNote(...): CourseMasterNote;
export function isCompletedMasterNote(note: CourseMasterNote | null, structureVersion: number): boolean;
```

Assembly orders completed chapters by the plan, adds the course and chapter framework, deduplicates only identical adjacent paragraphs, aggregates formula/glossary indexes, and computes coverage from `sourceCardIds`.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `npm test -- src/lib/__tests__/course-master-note.test.ts`

Expected: PASS.

### Task 4: Generate topic syntheses, a chapter plan, and chapter notes

**Files:**
- Create: `src/lib/master-note-generator.ts`
- Create: `src/lib/__tests__/master-note-generator.test.ts`

- [ ] **Step 1: Write failing prompt and orchestration tests**

Use an injected completion function and assert:

- topic synthesis input contains only that topic's cards;
- chapter planning input contains topic synthesis summaries, graph relations and traversal order, not source-document Markdown;
- chapter generation input contains only the chapter's syntheses, global terminology/symbol memory and the previous chapter summary;
- invalid or empty chapter Markdown marks that chapter failed;
- one chapter failure does not discard completed chapters.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm test -- src/lib/__tests__/master-note-generator.test.ts`

Expected: FAIL because the generator does not exist.

- [ ] **Step 3: Implement stable prompts and runtime validation**

Use fixed system prompts and append dynamic card content at the end. Require JSON for syntheses/planning and `{ markdown, glossary, formulas }` for chapter calls. Normalize/validate generated Markdown and reject `markdown.trim() === ''`.

- [ ] **Step 4: Implement partial progress callbacks**

Export a runner accepting:

```ts
interface MasterNoteGenerationCallbacks {
  onTopicSynthesis?: (synthesis: TopicSynthesis, current: number, total: number) => void;
  onPlan?: (plan: ChapterPlanItem[]) => void;
  onChapter?: (chapter: ChapterNote, current: number, total: number) => void;
}
```

The store can persist after every callback.

- [ ] **Step 5: Run the focused test and verify GREEN**

Run: `npm test -- src/lib/__tests__/master-note-generator.test.ts`

Expected: PASS.

### Task 5: Add store actions and recoverable generation state

**Files:**
- Modify: `src/store/useStore.ts`
- Create: `src/store/__tests__/master-note-generation.test.ts`

- [ ] **Step 1: Write failing store tests**

Test that `startMasterNoteGeneration` blocks without a model, persists partial chapter results, assembles a completed non-empty master note, and `retryChapterNote(chapterId)` changes only the requested chapter.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm test -- src/store/__tests__/master-note-generation.test.ts`

Expected: FAIL because the actions do not exist.

- [ ] **Step 3: Add state defaults and actions**

Add `startMasterNoteGeneration`, `retryChapterNote`, and `invalidateMasterNote`. Save after each topic synthesis, plan and chapter callback. Set `jobStatus` to completed only when `isCompletedMasterNote` is true; otherwise use failed or partial state with a visible error.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `npm test -- src/store/__tests__/master-note-generation.test.ts`

Expected: PASS.

### Task 6: Build the knowledge-card page

**Files:**
- Create: `src/components/KnowledgeCardsView.tsx`
- Create: `src/components/__tests__/KnowledgeCardsView.test.tsx`
- Modify: `src/App.tsx`
- Modify: `src/components/KnowledgeStructureView.tsx`

- [ ] **Step 1: Write the failing component test**

Assert cards are grouped by first-layer topic, the selected card shows summary/details/formulas, source ranges render on the right, and the primary action navigates to `notes` with label “生成完整笔记”.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm test -- src/components/__tests__/KnowledgeCardsView.test.tsx`

Expected: FAIL because the page does not exist.

- [ ] **Step 3: Implement the page and route**

Route `cards` in `App.tsx`. Change the structure-page action from “查看笔记” to “查看知识卡片” and navigate to `cards`. The page uses the existing source resolver and Markdown renderer; it never substitutes a source excerpt for a generated complete note.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `npm test -- src/components/__tests__/KnowledgeCardsView.test.tsx`

Expected: PASS.

### Task 7: Build the framework-first complete-note page

**Files:**
- Create: `src/components/MasterNoteView.tsx`
- Create: `src/components/__tests__/MasterNoteView.test.tsx`
- Modify: `src/components/NotesView.tsx`

- [ ] **Step 1: Write failing states and reading tests**

Cover: not generated, generating with phase/current chapter, partial with retry buttons, completed with course outline and Markdown, and a whitespace-only master note treated as not generated.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm test -- src/components/__tests__/MasterNoteView.test.tsx`

Expected: FAIL because the page does not exist.

- [ ] **Step 3: Implement framework-first UI**

Before generation, show the proposed chapter outline and “生成完整笔记”. During generation, show topic synthesis/chapter/assembly phases. Completed view uses `目录 | 正文 | 来源/卡片` and exposes Markdown export. Partial view keeps completed chapters readable and offers per-chapter retry.

- [ ] **Step 4: Use it for Markdown architecture**

Make `NotesView` render `MasterNoteView` when `sourceDocuments.length > 0`; preserve the legacy note UI for migrated legacy projects.

- [ ] **Step 5: Run the focused test and verify GREEN**

Run: `npm test -- src/components/__tests__/MasterNoteView.test.tsx`

Expected: PASS.

### Task 8: Verify the complete workflow

**Files:**
- Verify all changed files without overwriting unrelated worktree changes.

- [ ] **Step 1: Run focused tests**

Run: `npm test -- src/lib/__tests__/course-master-note.test.ts src/lib/__tests__/master-note-generator.test.ts src/lib/__tests__/workflow-navigation.test.ts src/components/__tests__/KnowledgeCardsView.test.tsx src/components/__tests__/MasterNoteView.test.tsx`

Expected: all PASS.

- [ ] **Step 2: Run complete automated verification**

Run: `npm test`

Expected: zero failures.

Run: `npm run check`

Expected: zero TypeScript errors.

Run: `npm run build`

Expected: successful production build.

Run: `npm run lint`

Expected: no new lint errors.

- [ ] **Step 3: Inspect the local UI**

Start the existing Vite server or reuse the running server. Verify the six sidebar stages, in-canvas subnet close control, grouped card page, framework-first master note page, and partial/empty states. Capture screenshots only after the specific changes render without visible defects.

- [ ] **Step 4: Check the diff**

Run: `git diff --check` and inspect `git status --short`.

Expected: no whitespace errors, no credentials, and no unrelated files staged.
