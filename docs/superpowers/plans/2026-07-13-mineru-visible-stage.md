# Visible MinerU Stage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a visible MinerU parse-and-review stage between source preview and knowledge extraction, with independent MinerU and knowledge-model configuration.

**Architecture:** Keep PDF/PPTX preview as the source-review stage, then submit the original file to MinerU's official asynchronous upload API. Persist only parsing metadata and normalized Markdown in project state; keep both service credentials in the existing local configuration storage, outside exported project state. Knowledge extraction consumes only confirmed `SourceDocument` Markdown.

**Tech Stack:** React 18, TypeScript, Zustand, Vitest, JSZip, MinerU Precision Extract API v4, existing OpenAI-compatible model client.

---

### Task 1: Five-stage workflow contract

**Files:**
- Modify: `src/types/index.ts`
- Modify: `src/lib/workflow-navigation.ts`
- Test: `src/lib/__tests__/workflow-navigation.test.ts`

- [ ] Add a failing test requiring `upload → document → mineru → structure → notes`.
- [ ] Run the focused test and confirm the four-stage implementation fails.
- [ ] Add MinerU job/result fields to the workflow snapshot and derive completion from successful Markdown output.
- [ ] Run the focused test and confirm navigation to completed earlier stages works.

### Task 2: Independent service configuration

**Files:**
- Modify: `src/types/index.ts`
- Modify: `src/lib/model-config-storage.ts`
- Test: `src/lib/__tests__/model-config-storage.test.ts`

- [ ] Add a failing test for separately saving/loading/clearing MinerU configuration.
- [ ] Run it and confirm the new API is missing.
- [ ] Implement validated local storage without placing credentials in project persistence.
- [ ] Run the focused test and confirm legacy model config still migrates.

### Task 3: MinerU precision extraction client

**Files:**
- Create: `src/lib/mineru-client.ts`
- Test: `src/lib/__tests__/mineru-client.test.ts`

- [ ] Test signed upload creation, binary PUT, polling state mapping, ZIP Markdown extraction, failure, and timeout.
- [ ] Confirm the tests fail before the client exists.
- [ ] Implement the official v4 batch upload flow with injected `fetch` and polling callbacks.
- [ ] Run focused tests and refactor only after green.

### Task 4: Store integration and persistence

**Files:**
- Modify: `src/store/useStore.ts`
- Modify: `src/lib/persistence.ts`
- Test: `src/lib/__tests__/persistence-migration.test.ts`

- [ ] Test schema migration defaults for MinerU stage data.
- [ ] Add independent configs, uploaded-source metadata, parsing progress, retry, Markdown import completion, and downstream invalidation.
- [ ] Persist parsing output/status but exclude API keys.
- [ ] Confirm Markdown direct import lands in the visible MinerU confirmation stage.

### Task 5: UI implementation

**Files:**
- Create: `src/components/MinerUParseView.tsx`
- Modify: `src/App.tsx`
- Modify: `src/components/Sidebar.tsx`
- Modify: `src/components/SettingsModal.tsx`
- Modify: `src/components/UploadView.tsx`
- Modify: `src/components/document-review/DocumentReviewWorkspace.tsx`

- [ ] Render the fifth workflow step and two independent configuration cards.
- [ ] Make source preview advance to MinerU instead of invoking knowledge extraction.
- [ ] Render parsing idle/running/failure/completed states and Markdown/raw tabs.
- [ ] Require confirmed Markdown and knowledge model configuration before extraction.

### Task 6: Verification

**Files:**
- Modify only files implicated by failures.

- [ ] Run focused tests.
- [ ] Run `npm test`.
- [ ] Run `npm run check` and `npm run build`.
- [ ] Start the development server and visually verify upload, preview, MinerU, structure navigation, and both config sections.
