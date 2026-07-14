# Multi-Course Knowledge Library and Card RAG Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the single-document application into a local-first multi-course library with separated two-layer graphs, narrative-ordered notes, and knowledge-card-indexed Q&A.

**Architecture:** Keep the existing document compiler intact inside a workspace shell. Add an IndexedDB repository for courses, document snapshots, card records, and chats; use a small Zustand navigation/library store for UI state. Treat the current `ProjectState` as one document snapshot, while course-level pages aggregate saved snapshots.

**Tech Stack:** React 18, TypeScript, Zustand, IndexedDB, Vitest, Tailwind CSS, existing DeepSeek-compatible chat client.

---

### Task 1: Local library repository and project snapshot migration

**Files:**
- Create: `src/lib/library-repository.ts`
- Create: `src/lib/__tests__/library-repository.test.ts`
- Modify: `src/types/index.ts`
- Modify: `src/lib/persistence.ts`

- [ ] Write a failing fake-IndexedDB test for creating a course, saving two document snapshots, listing them by course, and replacing card index records.
- [ ] Run `npm test -- src/lib/__tests__/library-repository.test.ts` and verify failure because the repository does not exist.
- [ ] Add `LibraryCourse`, `LibraryDocument`, `RetrievalRecord`, and repository functions with IndexedDB object stores and an in-memory fallback for tests/environments without IndexedDB.
- [ ] Mirror `saveState` to the active document snapshot without removing the existing schema-8 localStorage compatibility path.
- [ ] Run the repository and persistence tests, then commit.

### Task 2: Application shell, start page, and courseware library

**Files:**
- Create: `src/store/useLibraryStore.ts`
- Create: `src/components/HomeView.tsx`
- Create: `src/components/LibraryView.tsx`
- Create: `src/components/AppShell.tsx`
- Create: `src/components/__tests__/LibraryNavigation.test.tsx`
- Modify: `src/App.tsx`
- Modify: `src/components/UploadView.tsx`
- Modify: `src/components/Sidebar.tsx`
- Modify: `src/index.css`

- [ ] Write failing UI tests for entering the library, creating a course, opening its upload workspace, and returning home.
- [ ] Run the focused UI test and verify the missing views failure.
- [ ] Implement `home | library | workspace | qa` application navigation and local course/document loading.
- [ ] On upload, bind the new document to the active course and register it in the library repository.
- [ ] Add restrained editorial start/library screens consistent with the existing ink, paper, and celadon visual system.
- [ ] Run focused tests and commit.

### Task 3: Strictly separate first- and second-layer graph canvases

**Files:**
- Modify: `src/components/KnowledgeStructureView.tsx`
- Modify: `src/components/knowledge-network/KnowledgeNetworkCanvas.tsx`
- Modify: `src/lib/knowledge-network-adapter.ts`
- Modify: `src/components/__tests__/KnowledgeStructureView.network.test.tsx`
- Modify: `src/lib/__tests__/knowledge-network-adapter.test.ts`

- [ ] Change the current test to require that opening a topic removes every other course topic from the canvas and shows only that topic's teaching nodes.
- [ ] Run the focused tests and verify they fail against `buildExpandedKnowledgeNetwork`.
- [ ] Switch `currentNetwork` directly between `courseNetwork` and `teachingNetwork`; render a breadcrumb and top-left close control for the second layer.
- [ ] Remove production use of the merged graph adapter and its bridge edge.
- [ ] Run focused and full graph tests, then commit.

### Task 4: Preserve second-layer narrative order through cards and notes

**Files:**
- Modify: `src/types/index.ts`
- Modify: `src/lib/card-generator.ts`
- Modify: `src/lib/knowledge-pipeline-v2.ts`
- Modify: `src/lib/master-note-generator.ts`
- Modify: `src/store/useStore.ts`
- Create: `src/lib/__tests__/card-narrative-order.test.ts`
- Modify: `src/lib/__tests__/master-note-generator.test.ts`

- [ ] Write failing tests showing that `orderedTeachingBlockIds = [b2, b1]` produces cards and synthesis input in `[b2, b1]` order.
- [ ] Add `narrativeIndex` to cards and pass narrative paths to `generateCards`.
- [ ] Add `narrativePaths` and `teachingRelations` to master-note input; order cards deterministically before each synthesis request.
- [ ] Parse and validate structured topic sections/card bindings, repairing missing or duplicated card IDs in narrative order.
- [ ] Ensure chapter generation consumes ordered synthesis sections and coverage remains correct.
- [ ] Run focused and full note tests, then commit.

### Task 5: Knowledge-card index and all-course Q&A

**Files:**
- Create: `src/lib/card-retrieval.ts`
- Create: `src/lib/card-rag.ts`
- Create: `src/lib/__tests__/card-retrieval.test.ts`
- Create: `src/lib/__tests__/card-rag.test.ts`
- Create: `src/components/KnowledgeQaView.tsx`
- Create: `src/components/__tests__/KnowledgeQaView.test.tsx`
- Modify: `src/store/useLibraryStore.ts`
- Modify: `src/App.tsx`

- [ ] Write failing tests for keyword/BM25-style ranking, course filters, card citations, partial hits, and no-hit direct-answer fallback.
- [ ] Build retrieval/source records from saved `KnowledgeCard` values and replace records incrementally by document.
- [ ] Implement card-priority prompt construction: matched-card sections cite real card IDs; no-hit answers are explicitly tagged as general AI answers.
- [ ] Add the Q&A page with course filters, answer source labels, and a right-hand card detail panel.
- [ ] Run focused tests and commit.

### Task 6: Integration, migration, and verification

**Files:**
- Modify: `src/lib/__tests__/persistence-migration.test.ts`
- Modify: `src/store/__tests__/master-note-generation.test.ts`
- Modify: `README.md` if user-facing navigation requires documentation.

- [ ] Add integration coverage for importing two documents into one course, reopening each snapshot, and retrieving both documents' cards.
- [ ] Run `npm test`, `npm run check`, `npm run lint`, and `npm run build`.
- [ ] Inspect the working tree and ensure API keys, generated files, IndexedDB data, and `.worktrees` content are not staged.
- [ ] Run the application from the worktree and visually verify home, library, graph drill-down, ordered notes, and Q&A states.
- [ ] Commit final integration fixes.
