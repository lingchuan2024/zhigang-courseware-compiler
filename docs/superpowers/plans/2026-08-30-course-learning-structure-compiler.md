# Course Learning Structure Compiler Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the repeated topic/relationship/teaching extraction pipeline with a two-layer, evidence-backed course structure compiler whose learning order is produced deterministically.

**Architecture:** Add a focused `src/lib/course-structure/` domain with stable evidence spans, flat learning topics, controlled teaching units, explicit order constraints, and pure compilers for course and teaching order. A unified section compiler performs one model call per section batch; deterministic normalization and one compact curriculum review replace repeated per-topic calls. A legacy adapter keeps the existing knowledge network, cards, notes, persistence, and QA interfaces working during migration.

**Tech Stack:** TypeScript 5.5, React 18, Zustand, Vitest, existing OpenAI-compatible `callChatCompletion`, IndexedDB snapshots, existing Markdown block parser.

---

## File Map

### New domain files

- `src/lib/course-structure/types.ts` — canonical course-structure types and issue codes.
- `src/lib/course-structure/stable-identity.ts` — deterministic normalization and stable-key generation.
- `src/lib/course-structure/evidence-span.ts` — quote/offset resolution and evidence validation.
- `src/lib/course-structure/section-batching.ts` — document-safe section batching.
- `src/lib/course-structure/section-compiler.ts` — unified prompt, model call, and response parsing.
- `src/lib/course-structure/candidate-normalizer.ts` — evidence-preserving deterministic candidate merge.
- `src/lib/course-structure/curriculum-review.ts` — one compact global review with restricted operations.
- `src/lib/course-structure/course-scheduler.ts` — hard-constraint validation and stable pedagogical scheduling.
- `src/lib/course-structure/teaching-path-compiler.ts` — controlled-role narrative compilation.
- `src/lib/course-structure/validator.ts` — release gate and structured issues.
- `src/lib/course-structure/incremental-reconcile.ts` — section-cache reuse and stable-object alignment.
- `src/lib/course-structure/legacy-adapter.ts` — conversion to existing V2 view/card/note interfaces.
- `src/lib/course-structure/compiler.ts` — orchestration only; no parsing or scheduling internals.
- `src/lib/course-structure/index.ts` — public exports.

### New test files

- `src/lib/course-structure/__tests__/stable-identity.test.ts`
- `src/lib/course-structure/__tests__/evidence-span.test.ts`
- `src/lib/course-structure/__tests__/section-batching.test.ts`
- `src/lib/course-structure/__tests__/section-compiler.test.ts`
- `src/lib/course-structure/__tests__/candidate-normalizer.test.ts`
- `src/lib/course-structure/__tests__/curriculum-review.test.ts`
- `src/lib/course-structure/__tests__/course-scheduler.test.ts`
- `src/lib/course-structure/__tests__/teaching-path-compiler.test.ts`
- `src/lib/course-structure/__tests__/validator.test.ts`
- `src/lib/course-structure/__tests__/incremental-reconcile.test.ts`
- `src/lib/course-structure/__tests__/legacy-adapter.test.ts`
- `src/lib/course-structure/__tests__/compiler.integration.test.ts`

### Existing files modified

- `src/types/index.ts` — persist the canonical structure alongside legacy projections.
- `src/lib/model-usage.ts` — add unified compiler task types.
- `src/lib/extraction-errors.ts` — add compiler stages.
- `src/lib/knowledge-pipeline-v2.ts` — invoke the new compiler, create base cards only, and return the canonical structure.
- `src/lib/pipeline-progress.ts` — replace repeated relation/internal stages with compile/normalize/schedule/validate stages.
- `src/components/KnowledgeStructureView.tsx` — render degraded structures as usable results with warnings.
- `src/store/useStore.ts` — store the canonical structure and keep card enrichment outside structure readiness.
- `src/lib/persistence.ts` — include the canonical structure/checkpoints in snapshots.
- `src/lib/library-repository.ts` — clone the new snapshot fields safely.
- `src/store/__tests__/structure-extraction-persistence.test.ts` — assert canonical structure persistence.
- `src/store/__tests__/mineru-reparse-increment.test.ts` — assert changed-section-only recompilation/stale behavior.
- `src/lib/__tests__/knowledge-pipeline-v2-cards.test.ts` — update the card boundary: base cards exist, enrichment is separate.
- `src/lib/__tests__/pipeline-progress.test.ts` — verify the new progress stages.
- `src/components/__tests__/KnowledgeStructureView.network.test.tsx` — verify degraded-state rendering.
- `README.md` — describe the compiler instead of a generic knowledge network extraction pipeline.

### Legacy files deleted after the cutover

- `src/lib/topic-extraction-v2.ts`
- `src/lib/topic-reconciliation.ts`
- `src/lib/knowledge-relation-traversal.ts`
- `src/lib/teaching-structure.ts`
- Their tests that only protect the removed extraction behavior.

The existing `learning-order.ts` remains temporarily for old snapshots but is no longer called for newly compiled structures. Remove it only after repository-wide references reach zero.

---

### Task 1: Canonical IR and Stable Identity

**Files:**
- Create: `src/lib/course-structure/types.ts`
- Create: `src/lib/course-structure/stable-identity.ts`
- Create: `src/lib/course-structure/index.ts`
- Test: `src/lib/course-structure/__tests__/stable-identity.test.ts`

- [x] **Step 1: Write the failing stable-identity tests**

```typescript
import { describe, expect, it } from 'vitest';
import { evidenceStableKey, normalizeStableText, teachingUnitStableKey, topicStableKey } from '../stable-identity';

describe('stable course structure identity', () => {
  it('normalizes equivalent labels deterministically', () => {
    expect(normalizeStableText('  广义  线性模型（GLM） ')).toBe('广义 线性模型(glm)');
  });

  it('keeps keys stable across repeated compilation', () => {
    const evidence = evidenceStableKey('doc-1', 'hash-1', 0, 7, '最大化 对数似然');
    const topic = topicStableKey('course-1', '最大似然估计', ['MLE'], evidence);
    expect(topic).toBe(topicStableKey('course-1', ' 最大似然估计 ', ['mle'], evidence));
    expect(teachingUnitStableKey(topic, 'definition', evidence))
      .toBe(teachingUnitStableKey(topic, 'definition', evidence));
  });

  it('uses only the selected core evidence to disambiguate topic identity', () => {
    expect(topicStableKey('course-1', 'MLE', [], 'core-e1'))
      .not.toBe(topicStableKey('course-1', 'MLE', [], 'core-e2'));
  });
});
```

- [x] **Step 2: Run the test and verify the module is missing**

Run: `pnpm test -- src/lib/course-structure/__tests__/stable-identity.test.ts`

Expected: FAIL with `Failed to resolve import "../stable-identity"`.

- [x] **Step 3: Add the canonical types**

Create `types.ts` with the exact public contracts from the approved design:

```typescript
export type EvidenceRole = 'statement' | 'definition' | 'formula' | 'condition' | 'derivation' | 'example' | 'comparison' | 'application';
export type LearningGenre = 'concept' | 'derivation' | 'algorithm' | 'mechanism' | 'comparison' | 'case';
export type TeachingRole = 'motivation' | 'problem' | 'intuition' | 'definition' | 'formula' | 'condition' | 'derivation_step' | 'procedure_step' | 'property' | 'example' | 'comparison' | 'misconception' | 'application' | 'summary';
export type CourseStructureStatus = 'ready' | 'degraded' | 'failed';

export interface EvidenceSpan {
  id: string; stableKey: string; documentId: string; blockId: string;
  startOffset: number; endOffset: number; quote: string;
  role: EvidenceRole; contentHash: string;
}

export interface LearningTopic {
  id: string; stableKey: string; courseId: string; name: string; aliases: string[];
  learningObjective: string; scope: string; genre: LearningGenre;
  difficulty: 1 | 2 | 3 | 4 | 5; importance: 'core' | 'important' | 'supplementary';
  evidenceIds: string[]; sourceSectionIds: string[]; confidence: number;
  status: 'draft' | 'verified' | 'corrected';
}

export interface TeachingUnit {
  id: string; stableKey: string; topicId: string; role: TeachingRole;
  title: string; summary: string; evidenceIds: string[]; required: boolean;
  confidence: number; status: 'draft' | 'verified' | 'corrected';
}

export interface OrderConstraint {
  id: string; beforeTopicId: string; afterTopicId: string;
  strength: 'hard' | 'soft'; reason: string; evidenceIds: string[];
  source: 'explicit' | 'inferred' | 'corrected'; confidence: number;
}

export type CourseStructureIssueCode =
  | 'INVALID_EVIDENCE' | 'TOPIC_WITHOUT_EVIDENCE' | 'GENERIC_TOPIC'
  | 'REQUIRED_UNIT_WITHOUT_EVIDENCE' | 'UNKNOWN_TOPIC' | 'HARD_ORDER_CYCLE'
  | 'FAILED_SECTION_BATCH' | 'LOW_COVERAGE';

export interface CourseStructureIssue {
  code: CourseStructureIssueCode; severity: 'error' | 'warning'; message: string;
  topicId?: string; teachingUnitId?: string; blockId?: string; batchId?: string;
}

export interface CourseStructureValidation {
  issues: CourseStructureIssue[]; meaningfulBlockCount: number;
  coveredMeaningfulBlockCount: number; coverageRate: number;
}

export interface SectionCompilationCheckpoint {
  cacheKey: string; batchId: string; sectionIds: string[]; result: SectionCompilation;
}

export interface CourseLearningStructure {
  courseId: string; sourceVersion: number; structureVersion: number;
  compilerVersion: string; topics: LearningTopic[]; teachingUnits: TeachingUnit[];
  evidenceSpans: EvidenceSpan[]; orderConstraints: OrderConstraint[];
  orderedTopicIds: string[]; teachingPaths: Record<string, string[]>;
  status: CourseStructureStatus; validation: CourseStructureValidation;
  checkpoints: SectionCompilationCheckpoint[];
}
```

Define the draft and compilation types in the same file so later tasks do not invent incompatible signatures:

```typescript
export interface EvidenceSpanDraft { blockId: string; startOffset?: number; endOffset?: number; quote: string; role: EvidenceRole }
export interface TopicMentionDraft { localId: string; name: string; aliases: string[]; learningObjective: string; scope: string; genre: LearningGenre; difficulty: number; importance: LearningTopic['importance']; evidence: EvidenceSpanDraft[]; confidence: number }
export interface TeachingUnitDraft { localId: string; topicLocalId: string; role: TeachingRole; title: string; summary: string; evidence: EvidenceSpanDraft[]; required: boolean; confidence: number }
export interface OrderClaimDraft { beforeTopicLocalId: string; afterTopicLocalId: string; strength: 'hard' | 'soft'; reason: string; evidence: EvidenceSpanDraft[]; source: 'explicit' | 'inferred'; confidence: number }
export interface SectionCompilation { batchId: string; sectionIds: string[]; topicMentions: TopicMentionDraft[]; teachingUnits: TeachingUnitDraft[]; orderClaims: OrderClaimDraft[]; unresolvedReferences: string[]; confidence: number }
```

- [x] **Step 4: Implement deterministic key functions**

```typescript
function hash(input: string): string {
  let value = 5381;
  for (let index = 0; index < input.length; index++) value = ((value << 5) + value + input.charCodeAt(index)) | 0;
  return (value >>> 0).toString(16).padStart(8, '0');
}

export function normalizeStableText(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

export function evidenceStableKey(documentId: string, blockContentHash: string, startOffset: number, endOffset: number, quote: string): string {
  return `ev_${hash([documentId, blockContentHash, startOffset, endOffset, normalizeStableText(quote)].join('|'))}`;
}

export function topicStableKey(courseId: string, name: string, confirmedAliases: string[], coreEvidenceKey: string): string {
  return `topic_${hash([courseId, normalizeStableText(name), [...confirmedAliases].map(normalizeStableText).sort().join(','), coreEvidenceKey].join('|'))}`;
}

export function teachingUnitStableKey(topicKey: string, role: string, coreEvidenceKey: string): string {
  return `unit_${hash([topicKey, role, coreEvidenceKey].join('|'))}`;
}
```

`coreEvidenceKey` is the earliest valid evidence for the object in document/section/block/offset order. The normalizer must preserve that anchor when it merges later supporting evidence. Generated aliases are not “confirmed aliases”; they participate in duplicate detection but are excluded from the initial stable key. When a prior topic has `status: 'corrected'`, its aliases are treated as confirmed and its existing stable key is preserved by incremental reconciliation. This prevents ordinary evidence growth from changing topic or teaching-unit identity without adding a second aliases field to the IR.

Export all public symbols from `index.ts`.

- [x] **Step 5: Run tests and type checking**

Run: `pnpm test -- src/lib/course-structure/__tests__/stable-identity.test.ts`

Expected: PASS, 3 tests.

Run: `pnpm check`

Expected: exit 0.

- [x] **Step 6: Commit**

```bash
git add src/lib/course-structure
git commit -m "feat: add canonical course structure IR"
```

---

### Task 2: Evidence Span Resolution

**Files:**
- Create: `src/lib/course-structure/evidence-span.ts`
- Test: `src/lib/course-structure/__tests__/evidence-span.test.ts`

- [x] **Step 1: Write failing tests for offsets, quote repair, ambiguity, and shared evidence**

```typescript
import { describe, expect, it } from 'vitest';
import type { MarkdownBlock } from '../../../types';
import { resolveEvidenceSpan } from '../evidence-span';

const block: MarkdownBlock = {
  id: 'b1', documentId: 'd1', type: 'paragraph',
  content: '最大似然估计通过最大化似然函数估计参数。通常使用对数似然进行计算。',
  headingPath: ['参数估计'], orderIndex: 1, contentHash: 'h1',
};

describe('evidence span resolution', () => {
  it('accepts exact offsets', () => {
    const result = resolveEvidenceSpan({ blockId: 'b1', startOffset: 0, endOffset: 6, quote: '最大似然估计', role: 'definition' }, block);
    expect(result.span?.quote).toBe('最大似然估计');
  });

  it('repairs wrong offsets when the quote is unique', () => {
    const result = resolveEvidenceSpan({ blockId: 'b1', startOffset: 0, endOffset: 2, quote: '对数似然', role: 'formula' }, block);
    expect(result.span).toMatchObject({ startOffset: 24, endOffset: 28 });
  });

  it('rejects an ambiguous quote', () => {
    const repeated = { ...block, content: '模型用于估计。模型也用于预测。' };
    expect(resolveEvidenceSpan({ blockId: 'b1', quote: '模型', role: 'statement' }, repeated).issue?.code).toBe('INVALID_EVIDENCE');
  });
});
```

- [x] **Step 2: Run the test and verify failure**

Run: `pnpm test -- src/lib/course-structure/__tests__/evidence-span.test.ts`

Expected: FAIL because `resolveEvidenceSpan` does not exist.

- [x] **Step 3: Implement exact-or-unique quote resolution**

Implement this public signature:

```typescript
export function resolveEvidenceSpan(
  draft: EvidenceSpanDraft,
  block: MarkdownBlock,
): { span?: EvidenceSpan; issue?: CourseStructureIssue }
```

The algorithm must:

1. Reject a mismatched `blockId`.
2. Accept supplied offsets only when `block.content.slice(startOffset, endOffset)` equals `quote` after whitespace normalization.
3. Otherwise find every exact occurrence of `quote`; accept only one occurrence.
4. Build `stableKey` with `evidenceStableKey`, set `id = stableKey`, and preserve the block content hash.
5. Return `INVALID_EVIDENCE` instead of throwing for model-produced bad evidence.

Use this helper to find all positions:

```typescript
function allOccurrences(content: string, quote: string): number[] {
  const indexes: number[] = [];
  for (let from = 0;;) {
    const index = content.indexOf(quote, from);
    if (index < 0) return indexes;
    indexes.push(index);
    from = index + Math.max(1, quote.length);
  }
}
```

- [x] **Step 4: Run focused tests**

Run: `pnpm test -- src/lib/course-structure/__tests__/evidence-span.test.ts`

Expected: PASS, 3 tests.

- [x] **Step 5: Commit**

```bash
git add src/lib/course-structure/evidence-span.ts src/lib/course-structure/__tests__/evidence-span.test.ts
git commit -m "feat: add block-level evidence spans"
```

---

### Task 3: Deterministic Course and Teaching Order Compilers

**Files:**
- Create: `src/lib/course-structure/course-scheduler.ts`
- Create: `src/lib/course-structure/teaching-path-compiler.ts`
- Test: `src/lib/course-structure/__tests__/course-scheduler.test.ts`
- Test: `src/lib/course-structure/__tests__/teaching-path-compiler.test.ts`

- [x] **Step 1: Write failing course-scheduler tests**

```typescript
import { describe, expect, it } from 'vitest';
import type { LearningTopic, OrderConstraint } from '../types';
import { compileCourseOrder } from '../course-scheduler';

const topic = (id: string, difficulty: 1 | 2 | 3 | 4 | 5, importance: LearningTopic['importance'] = 'important'): LearningTopic => ({
  id, stableKey: id, courseId: 'c', name: id, aliases: [], learningObjective: `掌握 ${id}`,
  scope: id, genre: 'concept', difficulty, importance, evidenceIds: [`e-${id}`],
  sourceSectionIds: ['s1'], confidence: 0.9, status: 'verified',
});

const hard = (id: string, before: string, after: string, source: OrderConstraint['source'] = 'explicit', confidence = 0.9): OrderConstraint => ({
  id, beforeTopicId: before, afterTopicId: after, strength: 'hard', reason: `${before} before ${after}`,
  evidenceIds: source === 'inferred' ? [] : ['e'], source, confidence,
});

describe('course scheduler', () => {
  it('satisfies hard constraints before pedagogical preferences', () => {
    expect(compileCourseOrder([topic('advanced', 5, 'core'), topic('basic', 1)], [hard('r1', 'basic', 'advanced')], new Map([['s1', 0]])).orderedTopicIds)
      .toEqual(['basic', 'advanced']);
  });

  it('removes the weakest inferred edge in a cycle', () => {
    const result = compileCourseOrder([topic('a', 1), topic('b', 2)], [hard('r1', 'a', 'b'), hard('r2', 'b', 'a', 'inferred', 0.2)], new Map([['s1', 0]]));
    expect(result.orderedTopicIds).toEqual(['a', 'b']);
    expect(result.removedConstraintIds).toEqual(['r2']);
  });

  it('degrades instead of deleting a corrected cycle', () => {
    const result = compileCourseOrder([topic('a', 1), topic('b', 2)], [hard('r1', 'a', 'b', 'corrected'), hard('r2', 'b', 'a', 'corrected')], new Map([['s1', 0]]));
    expect(result.status).toBe('degraded');
    expect(result.issues[0].code).toBe('HARD_ORDER_CYCLE');
  });
});
```

- [x] **Step 2: Write failing teaching-path tests**

```typescript
import { describe, expect, it } from 'vitest';
import type { TeachingUnit } from '../types';
import { compileTeachingPath } from '../teaching-path-compiler';

const unit = (id: string, role: TeachingUnit['role']): TeachingUnit => ({
  id, stableKey: id, topicId: 't1', role, title: id, summary: id,
  evidenceIds: [`e-${id}`], required: true, confidence: 0.9, status: 'verified',
});

describe('teaching path compiler', () => {
  it('uses the concept template without creating missing roles', () => {
    expect(compileTeachingPath('concept', [unit('example', 'example'), unit('definition', 'definition'), unit('intuition', 'intuition')], new Map()))
      .toEqual(['intuition', 'definition', 'example']);
  });

  it('uses source order before stable keys inside the same role', () => {
    const sourceOrder = new Map([['e-step-b', 1], ['e-step-a', 2]]);
    expect(compileTeachingPath('derivation', [unit('step-a', 'derivation_step'), unit('step-b', 'derivation_step')], sourceOrder))
      .toEqual(['step-b', 'step-a']);
  });
});
```

- [x] **Step 3: Run both tests and verify failure**

Run: `pnpm test -- src/lib/course-structure/__tests__/course-scheduler.test.ts src/lib/course-structure/__tests__/teaching-path-compiler.test.ts`

Expected: FAIL because both compiler modules are missing.

- [x] **Step 4: Implement the teaching role templates**

Export an immutable template map and a stable compiler:

```typescript
const TEMPLATES: Record<LearningGenre, TeachingRole[]> = {
  concept: ['problem', 'motivation', 'intuition', 'definition', 'condition', 'property', 'example', 'application', 'misconception', 'summary'],
  derivation: ['problem', 'condition', 'definition', 'formula', 'derivation_step', 'summary', 'example', 'application'],
  algorithm: ['problem', 'intuition', 'condition', 'procedure_step', 'property', 'example', 'application', 'summary'],
  mechanism: ['problem', 'motivation', 'definition', 'procedure_step', 'condition', 'property', 'application', 'summary'],
  comparison: ['problem', 'definition', 'comparison', 'condition', 'example', 'application', 'summary'],
  case: ['problem', 'condition', 'procedure_step', 'example', 'comparison', 'summary'],
};

export function compileTeachingPath(
  genre: LearningGenre,
  units: TeachingUnit[],
  sourceOrderByEvidenceId: ReadonlyMap<string, number>,
): string[] {
  const rank = new Map(TEMPLATES[genre].map((role, index) => [role, index]));
  const sourceOrder = (unit: TeachingUnit) => Math.min(...unit.evidenceIds.map(id => sourceOrderByEvidenceId.get(id) ?? Number.POSITIVE_INFINITY));
  return [...units]
    .sort((left, right) => (rank.get(left.role) ?? 999) - (rank.get(right.role) ?? 999) || sourceOrder(left) - sourceOrder(right) || left.stableKey.localeCompare(right.stableKey))
    .map(unit => unit.id);
}
```

- [x] **Step 5: Implement hard-cycle resolution and stable Kahn scheduling**

Export:

```typescript
export interface CourseScheduleResult {
  orderedTopicIds: string[];
  removedConstraintIds: string[];
  status: 'ready' | 'degraded';
  issues: CourseStructureIssue[];
  explanations: Record<string, string>;
}

export function compileCourseOrder(
  topics: LearningTopic[],
  constraints: OrderConstraint[],
  sectionOrderById: ReadonlyMap<string, number>,
): CourseScheduleResult
```

Implementation rules:

- Discard constraints with unknown endpoints or self-loops and report `UNKNOWN_TOPIC` warnings.
- Detect cycles over hard constraints.
- While a cycle exists, remove only the lowest-confidence `inferred` edge in that cycle.
- If no removable inferred edge exists, return `degraded`; append remaining topics by stable key so the UI remains usable.
- Among zero-indegree topics, sort by: number of satisfied incoming soft constraints descending, importance (`core`, `important`, `supplementary`), difficulty ascending, minimum numeric value looked up from `sectionOrderById`, stable key. Missing sections sort after known sections. Build this map once from document/block order in the orchestrator; never infer order from opaque section ID strings.
- Explanations use existing constraint reasons; do not call an LLM.

- [x] **Step 6: Run focused tests and type checking**

Run: `pnpm test -- src/lib/course-structure/__tests__/course-scheduler.test.ts src/lib/course-structure/__tests__/teaching-path-compiler.test.ts`

Expected: PASS, 5 tests.

Run: `pnpm check`

Expected: exit 0.

- [x] **Step 7: Commit**

```bash
git add src/lib/course-structure/course-scheduler.ts src/lib/course-structure/teaching-path-compiler.ts src/lib/course-structure/__tests__
git commit -m "feat: compile deterministic learning paths"
```

---

### Task 4: Document-Safe Section Batching

**Files:**
- Create: `src/lib/course-structure/section-batching.ts`
- Test: `src/lib/course-structure/__tests__/section-batching.test.ts`

- [x] **Step 1: Write failing batching tests**

```typescript
import { describe, expect, it } from 'vitest';
import type { SourceDocument } from '../../../types';
import { buildSectionBatches } from '../section-batching';

function document(id: string, contents: string[]): SourceDocument {
  return {
    id, courseId: 'course', title: id, markdown: contents.join('\n\n'), outline: [],
    contentHash: `hash-${id}`, createdAt: '', updatedAt: '',
    blocks: contents.map((content, orderIndex) => ({
      id: `${id}-b${orderIndex}`, documentId: id, type: orderIndex === 0 ? 'heading' : 'paragraph',
      content, headingPath: [id], orderIndex, contentHash: `${id}-h${orderIndex}`,
      ...(orderIndex === 0 ? { headingLevel: 1 } : {}),
    })),
  };
}

describe('section batching', () => {
  it('never mixes documents in one batch', () => {
    const batches = buildSectionBatches([document('d1', ['# A', 'a']), document('d2', ['# B', 'b'])], 1000);
    expect(batches.every(batch => new Set(batch.blocks.map(block => block.documentId)).size === 1)).toBe(true);
  });

  it('keeps every block exactly once without overlap duplication', () => {
    const doc = document('d1', ['# A', 'a'.repeat(80), 'b'.repeat(80), 'c'.repeat(80)]);
    const batches = buildSectionBatches([doc], 60);
    expect(batches.flatMap(batch => batch.blocks.map(block => block.id))).toEqual(doc.blocks.map(block => block.id));
  });
});
```

- [x] **Step 2: Run and verify failure**

Run: `pnpm test -- src/lib/course-structure/__tests__/section-batching.test.ts`

Expected: FAIL because the batching module is missing.

- [x] **Step 3: Implement section-aware batching**

Define:

```typescript
export interface SectionBatch {
  id: string;
  documentId: string;
  documentTitle: string;
  sectionIds: string[];
  blocks: MarkdownBlock[];
  estimatedTokens: number;
  cacheKey: string;
}

export function buildSectionBatches(documents: SourceDocument[], maxTokens = 6000): SectionBatch[]
```

Use `SourceDocument.outline` when present. If it is empty, derive top-level section boundaries from heading blocks. Pack adjacent sections until the next section would exceed `maxTokens`. Split an oversized section at block boundaries. Use `estimateTokens` from `content-window.ts` during migration and generate a cache key from document content hash, section IDs, block content hashes, and compiler prompt version.

- [x] **Step 4: Run focused tests**

Run: `pnpm test -- src/lib/course-structure/__tests__/section-batching.test.ts`

Expected: PASS, 2 tests.

- [x] **Step 5: Commit**

```bash
git add src/lib/course-structure/section-batching.ts src/lib/course-structure/__tests__/section-batching.test.ts
git commit -m "feat: batch course content by document section"
```

---

### Task 5: Unified Section Compiler

**Files:**
- Create: `src/lib/course-structure/section-compiler.ts`
- Test: `src/lib/course-structure/__tests__/section-compiler.test.ts`
- Modify: `src/lib/model-usage.ts`
- Modify: `src/lib/extraction-errors.ts`

- [x] **Step 1: Add failing parser and one-call tests**

Mock `callChatCompletion` rather than global fetch so the test asserts the domain boundary:

```typescript
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModelConfig } from '../../../types';
import type { SectionBatch } from '../section-batching';

const mocks = vi.hoisted(() => ({ callChatCompletion: vi.fn() }));
vi.mock('../../model-v2', () => ({ callChatCompletion: mocks.callChatCompletion }));
import { compileSectionBatch } from '../section-compiler';

const config: ModelConfig = { endpoint: 'https://example.test', model: 'test', apiKey: 'key' };
const batch: SectionBatch = {
  id: 'batch-d1-0', documentId: 'd1', documentTitle: '参数估计', sectionIds: ['s1'], estimatedTokens: 20, cacheKey: 'cache',
  blocks: [{ id: 'b1', documentId: 'd1', type: 'paragraph', content: 'MLE 最大化似然函数。', headingPath: ['参数估计'], orderIndex: 0, contentHash: 'h1' }],
};

describe('unified section compiler', () => {
  beforeEach(() => mocks.callChatCompletion.mockReset());

  it('extracts topic, teaching units, order claims, and evidence in one call', async () => {
    mocks.callChatCompletion.mockResolvedValue({ data: {
      topicMentions: [{ localId: 't1', name: '最大似然估计', aliases: ['MLE'], learningObjective: '能够解释 MLE', scope: '参数估计', genre: 'concept', difficulty: 2, importance: 'core', evidence: [{ blockId: 'b1', quote: 'MLE 最大化似然函数', role: 'definition' }], confidence: 0.9 }],
      teachingUnits: [{ localId: 'u1', topicLocalId: 't1', role: 'definition', title: 'MLE 定义', summary: '最大化似然', evidence: [{ blockId: 'b1', quote: 'MLE 最大化似然函数', role: 'definition' }], required: true, confidence: 0.9 }],
      orderClaims: [], unresolvedReferences: [], confidence: 0.9,
    }, usage: {} });

    const result = await compileSectionBatch(config, batch);
    expect(mocks.callChatCompletion).toHaveBeenCalledOnce();
    expect(result.topicMentions[0].localId).toBe('batch-d1-0:t1');
    expect(result.teachingUnits[0].topicLocalId).toBe('batch-d1-0:t1');
  });

  it('drops references to unknown local topics', async () => {
    mocks.callChatCompletion.mockResolvedValue({ data: { topicMentions: [], teachingUnits: [{ localId: 'u1', topicLocalId: 'missing', role: 'definition', title: 'x', summary: 'x', evidence: [], required: true, confidence: 1 }], orderClaims: [], unresolvedReferences: [], confidence: 0.2 }, usage: {} });
    expect((await compileSectionBatch(config, batch)).teachingUnits).toEqual([]);
  });
});
```

- [x] **Step 2: Extend model usage and error stages**

Add `'course-section-compile' | 'course-curriculum-review'` to `ModelTaskType`.

Add `'section-compile' | 'curriculum-review'` to `ExtractionStage` and Chinese labels to `toUserMessage()`.

- [x] **Step 3: Run and verify failure**

Run: `pnpm test -- src/lib/course-structure/__tests__/section-compiler.test.ts`

Expected: FAIL because `compileSectionBatch` is missing.

- [x] **Step 4: Implement the unified prompt and response parser**

Export:

```typescript
export function buildSectionCompilerPrompt(batch: SectionBatch): CompiledPrompt
export async function compileSectionBatch(config: ModelConfig, batch: SectionBatch): Promise<SectionCompilation>
```

The system prompt must state:

- First-layer topics require independent learning objectives.
- Definitions/formulas/steps that are not independent goals belong to teaching units.
- Only the controlled `LearningGenre`, `TeachingRole`, and `EvidenceRole` values are allowed.
- Every topic and teaching unit must quote real input blocks.
- Order direction always means `beforeTopicLocalId` is learned before `afterTopicLocalId`.
- `hard` is reserved for actual dependency; inferred relations are soft.
- Return one JSON object and no prose.

The parser must clamp difficulty/confidence, namespace every local ID with `batch.id`, validate enum values, remove unknown topic references, and retain unresolved references for validation. Call:

```typescript
callChatCompletion<RawSectionCompilation>(
  config,
  prompt,
  'course-section-compile',
  120000,
  batch.id,
  'section-compile',
)
```

- [x] **Step 5: Run focused tests and type checking**

Run: `pnpm test -- src/lib/course-structure/__tests__/section-compiler.test.ts src/lib/__tests__/model-usage.test.ts`

Expected: PASS.

Run: `pnpm check`

Expected: exit 0.

- [x] **Step 6: Commit**

```bash
git add src/lib/course-structure/section-compiler.ts src/lib/course-structure/__tests__/section-compiler.test.ts src/lib/model-usage.ts src/lib/extraction-errors.ts
git commit -m "feat: compile each course section in one model call"
```

---

### Task 6: Evidence-Preserving Candidate Normalization

**Files:**
- Create: `src/lib/course-structure/candidate-normalizer.ts`
- Test: `src/lib/course-structure/__tests__/candidate-normalizer.test.ts`

- [x] **Step 1: Write failing normalization tests**

```typescript
import { describe, expect, it } from 'vitest';
import { normalizeCandidates } from '../candidate-normalizer';

describe('candidate normalization', () => {
  it('merges overlap duplicates and preserves the complete evidence union', () => {
    const result = normalizeCandidates('course', [
      { localId: 'b1:t1', name: '最大似然估计', aliases: ['MLE'], learningObjective: '解释 MLE', scope: '估计参数', genre: 'concept', difficulty: 2, importance: 'core', evidenceIds: ['e1', 'e2'], sectionIds: ['s1'], confidence: 0.8 },
      { localId: 'b2:t1', name: '最大似然估计', aliases: [], learningObjective: '解释最大似然估计', scope: '估计参数', genre: 'concept', difficulty: 2, importance: 'core', evidenceIds: ['e2', 'e3'], sectionIds: ['s1'], confidence: 0.9 },
    ]);
    expect(result.topics).toHaveLength(1);
    expect(result.topics[0].evidenceIds).toEqual(['e1', 'e2', 'e3']);
  });

  it('keeps same-name candidates separate when objectives and evidence do not overlap', () => {
    const result = normalizeCandidates('course', [
      { localId: 'a', name: '模型', aliases: [], learningObjective: '解释统计模型', scope: '概率', genre: 'concept', difficulty: 1, importance: 'important', evidenceIds: ['e1'], sectionIds: ['prob'], confidence: 0.9 },
      { localId: 'b', name: '模型', aliases: [], learningObjective: '构建机械模型', scope: '力学', genre: 'mechanism', difficulty: 2, importance: 'important', evidenceIds: ['e2'], sectionIds: ['mechanics'], confidence: 0.9 },
    ]);
    expect(result.topics).toHaveLength(2);
  });

  it('allows one evidence span to support two distinct learning topics', () => {
    const result = normalizeCandidates('course', [
      { localId: 'a', name: '似然函数', aliases: [], learningObjective: '解释似然函数', scope: '参数估计', genre: 'concept', difficulty: 1, importance: 'core', evidenceIds: ['shared-e1'], sectionIds: ['s1'], confidence: 0.9 },
      { localId: 'b', name: '最大似然估计', aliases: ['MLE'], learningObjective: '使用 MLE 估计参数', scope: '参数估计', genre: 'algorithm', difficulty: 2, importance: 'core', evidenceIds: ['shared-e1'], sectionIds: ['s1'], confidence: 0.9 },
    ]);
    expect(result.topics).toHaveLength(2);
    expect(result.topics.every(topic => topic.evidenceIds.includes('shared-e1'))).toBe(true);
  });
});
```

- [x] **Step 2: Run and verify failure**

Run: `pnpm test -- src/lib/course-structure/__tests__/candidate-normalizer.test.ts`

Expected: FAIL because the normalizer is missing.

- [x] **Step 3: Implement deterministic normalization**

Define an internal resolved draft type and return mapping:

```typescript
export interface ResolvedTopicDraft {
  localId: string; name: string; aliases: string[]; learningObjective: string;
  scope: string; genre: LearningGenre; difficulty: number;
  importance: LearningTopic['importance']; evidenceIds: string[];
  sectionIds: string[]; confidence: number;
}

export interface CandidateNormalizationResult {
  topics: LearningTopic[];
  localTopicToCanonicalId: Map<string, string>;
  ambiguousPairs: Array<[string, string]>;
}
```

Automatically merge only when normalized names/aliases match and either evidence Jaccard overlap is positive or section IDs overlap. Preserve sorted unions of aliases and sections. Preserve evidence in document/section/block/offset order, deduplicate it, and keep the first evidence key as the core identity anchor; later supporting evidence must not alter the stable key. Keep same-name candidates separate otherwise and emit them as an ambiguous pair only when objective token overlap is non-zero. Use `topicStableKey(courseId, name, [], coreEvidenceKey)` for new generated topics; corrected prior topics retain their prior stable key during incremental reconciliation.

- [x] **Step 4: Run focused tests**

Run: `pnpm test -- src/lib/course-structure/__tests__/candidate-normalizer.test.ts`

Expected: PASS, 3 tests.

- [x] **Step 5: Commit**

```bash
git add src/lib/course-structure/candidate-normalizer.ts src/lib/course-structure/__tests__/candidate-normalizer.test.ts
git commit -m "feat: normalize course topics without losing evidence"
```

---

### Task 7: Restricted Curriculum Review

**Files:**
- Create: `src/lib/course-structure/curriculum-review.ts`
- Test: `src/lib/course-structure/__tests__/curriculum-review.test.ts`

- [x] **Step 1: Write failing operation-validation tests**

```typescript
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ callChatCompletion: vi.fn() }));
vi.mock('../../model-v2', () => ({ callChatCompletion: mocks.callChatCompletion }));
import { reviewCurriculum } from '../curriculum-review';

describe('restricted curriculum review', () => {
  beforeEach(() => mocks.callChatCompletion.mockReset());

  it('rejects operations that cite unknown topics or evidence', async () => {
    mocks.callChatCompletion.mockResolvedValue({ data: {
      operations: [{ type: 'merge', topicIds: ['known', 'invented'], reason: 'same' }],
      constraints: [{ beforeTopicId: 'known', afterTopicId: 'invented', strength: 'hard', reason: 'dependency', evidenceIds: ['invented-evidence'], confidence: 1 }],
    }, usage: {} });
    const evidenceById = new Map([['e1', { id: 'e1', stableKey: 'e1', documentId: 'd1', blockId: 'b1', startOffset: 0, endOffset: 5, quote: 'Known', role: 'definition', contentHash: 'h1' }]]);
    const result = await reviewCurriculum({ endpoint: 'x', model: 'm', apiKey: 'k' }, [{ id: 'known', stableKey: 'known', courseId: 'c', name: 'Known', aliases: [], learningObjective: '理解 Known', scope: 'Known', genre: 'concept', difficulty: 1, importance: 'core', evidenceIds: ['e1'], sourceSectionIds: ['s1'], confidence: 1, status: 'verified' }], evidenceById);
    expect(result.operations).toEqual([]);
    expect(result.constraints).toEqual([]);
  });
});
```

- [x] **Step 2: Run and verify failure**

Run: `pnpm test -- src/lib/course-structure/__tests__/curriculum-review.test.ts`

Expected: FAIL because `reviewCurriculum` is missing.

- [x] **Step 3: Implement one compact review call**

Export:

```typescript
export type CurriculumOperation =
  | { type: 'merge'; topicIds: string[]; reason: string }
  | { type: 'drop'; topicIds: string[]; reason: string };

export interface CurriculumReviewResult {
  operations: CurriculumOperation[];
  constraints: OrderConstraint[];
  warnings: CourseStructureIssue[];
}

export async function reviewCurriculum(
  config: ModelConfig,
  topics: LearningTopic[],
  evidenceById: ReadonlyMap<string, EvidenceSpan>,
): Promise<CurriculumReviewResult>
```

Send only ID, name, aliases, objective, scope, genre, difficulty, importance, evidence IDs, and short evidence quotes resolved through `evidenceById`. The model cannot add topics. Validate all IDs against the input topics and all returned evidence IDs against `evidenceById` after the response. Convert inferred hard constraints to soft unless they carry at least one valid evidence ID. Use task type `course-curriculum-review` and stage `curriculum-review`.

- [x] **Step 4: Run focused tests**

Run: `pnpm test -- src/lib/course-structure/__tests__/curriculum-review.test.ts`

Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add src/lib/course-structure/curriculum-review.ts src/lib/course-structure/__tests__/curriculum-review.test.ts
git commit -m "feat: add constrained curriculum review"
```

---

### Task 8: Structure Validation and Legacy Projection

**Files:**
- Create: `src/lib/course-structure/validator.ts`
- Create: `src/lib/course-structure/legacy-adapter.ts`
- Test: `src/lib/course-structure/__tests__/validator.test.ts`
- Test: `src/lib/course-structure/__tests__/legacy-adapter.test.ts`

- [x] **Step 1: Write failing validation tests**

Cover these exact release gates:

```typescript
it('fails when no valid topics exist', () => expect(validateCourseStructure(emptyInput).status).toBe('failed'));
it('degrades when a required unit lacks evidence', () => expect(validateCourseStructure(inputWithRequiredUnitWithoutEvidence).status).toBe('degraded'));
it('degrades on unresolved corrected hard cycles', () => expect(validateCourseStructure(inputWithCycleIssue).status).toBe('degraded'));
it('is ready only when evidence, topics, units, and order are valid', () => expect(validateCourseStructure(validInput).status).toBe('ready'));
```

Build fixtures explicitly in the test file using the Task 1 types; do not mock the validator.

- [x] **Step 2: Write failing adapter tests**

```typescript
it('projects flat topics without parentTopicId', () => {
  const projected = projectLegacyStructure(canonical, sourceBlocks);
  expect(projected.topics[0].parentTopicId).toBeUndefined();
  expect(projected.topics[0].courseId).toBe('course-1');
});

it('projects teaching units and deterministic paths', () => {
  const projected = projectLegacyStructure(canonical, sourceBlocks);
  expect(projected.teachingBlocks[0].type).toBe('definition');
  expect(projected.narrativePaths['topic-1'].orderedTeachingBlockIds).toEqual(['unit-1']);
});
```

- [x] **Step 3: Run and verify failure**

Run: `pnpm test -- src/lib/course-structure/__tests__/validator.test.ts src/lib/course-structure/__tests__/legacy-adapter.test.ts`

Expected: FAIL because both modules are missing.

- [x] **Step 4: Implement the release-gate validator**

Export:

```typescript
export interface CourseStructureValidationInput {
  topics: LearningTopic[]; teachingUnits: TeachingUnit[]; evidenceSpans: EvidenceSpan[];
  orderedTopicIds: string[]; orderConstraints: OrderConstraint[];
  schedulerIssues: CourseStructureIssue[]; failedBatchIds: string[];
  meaningfulBlockIds: string[];
}

export function validateCourseStructure(input: CourseStructureValidationInput): { status: CourseStructureStatus; validation: CourseStructureValidation }
```

`failed` is reserved for zero valid topics or corrupt canonical IDs. All other error-severity issues produce `degraded`. Coverage uses meaningful non-heading blocks and exact EvidenceSpan block IDs, not expanded topic ranges.

- [x] **Step 5: Implement the single legacy adapter boundary**

Export:

```typescript
export interface LegacyStructureProjection {
  topics: KnowledgeTopic[]; topicRelations: TopicRelation[];
  teachingBlocks: TeachingBlock[]; teachingRelations: TeachingRelation[];
  courseLearningPath: CourseLearningPath;
  narrativePaths: Record<string, TopicNarrativePath>;
}

export function projectLegacyStructure(structure: CourseLearningStructure, blocks: MarkdownBlock[]): LegacyStructureProjection
```

Group EvidenceSpan block IDs into contiguous `SourceRange` values without dropping intermediate evidence. Project hard/soft constraints as `hard_prerequisite`/`helpful_before` only for display compatibility. Project consecutive path items into `TeachingRelation` values of type `should_explain_before`. Use `status: 'generated'` for draft/verified and `status: 'corrected'` for corrected canonical topics.

- [x] **Step 6: Run focused tests and type checking**

Run: `pnpm test -- src/lib/course-structure/__tests__/validator.test.ts src/lib/course-structure/__tests__/legacy-adapter.test.ts`

Expected: PASS.

Run: `pnpm check`

Expected: exit 0.

- [x] **Step 7: Commit**

```bash
git add src/lib/course-structure/validator.ts src/lib/course-structure/legacy-adapter.ts src/lib/course-structure/__tests__
git commit -m "feat: validate and project compiled course structures"
```

---

### Task 9: Orchestrate the New Compiler

**Files:**
- Create: `src/lib/course-structure/compiler.ts`
- Test: `src/lib/course-structure/__tests__/compiler.integration.test.ts`
- Modify: `src/lib/course-structure/index.ts`

- [x] **Step 1: Write a failing end-to-end compiler test with mocked section/review calls**

The fixture must contain two documents and assert:

- Batches do not cross documents.
- `compileSectionBatch` is called exactly once per batch.
- No call occurs per topic.
- Shared block evidence produces two valid topics without duplicate warnings.
- All hard constraints are satisfied by `orderedTopicIds`.
- Teaching paths use controlled roles.

Use dependency injection instead of module-wide mocks:

```typescript
const result = await compileCourseStructure(config, documents, 'course-1', {
  compileBatch: async batch => fixtureCompilations[batch.id],
  review: async () => ({ operations: [], constraints: [], warnings: [] }),
});
expect(batchCallCount).toBe(buildSectionBatches(documents).length);
expect(result.status).toBe('ready');
```

- [x] **Step 2: Run and verify failure**

Run: `pnpm test -- src/lib/course-structure/__tests__/compiler.integration.test.ts`

Expected: FAIL because the orchestrator is missing.

- [x] **Step 3: Implement orchestration without domain logic duplication**

Export:

```typescript
export interface CourseCompilerDependencies {
  compileBatch?: typeof compileSectionBatch;
  review?: typeof reviewCurriculum;
  previous?: CourseLearningStructure | null;
  onBatchProgress?: (current: number, total: number) => void;
  onStage?: (stage: 'batching' | 'compiling' | 'normalizing' | 'reviewing' | 'scheduling' | 'validating') => void;
}

export async function compileCourseStructure(
  config: ModelConfig,
  documents: SourceDocument[],
  courseId: string,
  dependencies: CourseCompilerDependencies = {},
): Promise<CourseLearningStructure>
```

The function must only coordinate existing modules:

1. Build batches.
2. Reuse matching checkpoints from `previous`.
3. Compile remaining batches with concurrency 2.
4. Resolve evidence and retain structured issues.
5. Normalize candidates and map teaching units/order claims through canonical topic IDs.
6. Apply only validated curriculum operations.
7. Build `sectionOrderById` and `sourceOrderByEvidenceId` from source document/block/offset order, then compile course and teaching paths.
8. Validate and assign final status.
9. Return checkpoints for every successful batch.

Set `compilerVersion = 'course-structure-v1'`. Increment `structureVersion` from `previous?.structureVersion ?? 0` only when canonical content changes.

- [x] **Step 4: Run integration and focused domain tests**

Run: `pnpm test -- src/lib/course-structure`

Expected: PASS for every course-structure test file.

- [x] **Step 5: Commit**

```bash
git add src/lib/course-structure/compiler.ts src/lib/course-structure/index.ts src/lib/course-structure/__tests__/compiler.integration.test.ts
git commit -m "feat: orchestrate the course structure compiler"
```

---

### Task 10: Incremental Reconciliation and Persistence

**Files:**
- Create: `src/lib/course-structure/incremental-reconcile.ts`
- Test: `src/lib/course-structure/__tests__/incremental-reconcile.test.ts`
- Modify: `src/types/index.ts`
- Modify: `src/lib/persistence.ts`
- Modify: `src/lib/library-repository.ts`
- Modify: `src/store/__tests__/structure-extraction-persistence.test.ts`
- Modify: `src/store/__tests__/mineru-reparse-increment.test.ts`

- [x] **Step 1: Write failing incremental tests**

```typescript
it('reuses unchanged section checkpoints', () => {
  const result = reconcileIncremental(previous, nextBatches);
  expect(result.reusedBatchIds).toEqual(['batch-a']);
  expect(result.changedBatchIds).toEqual(['batch-b']);
});

it('preserves corrected topic identity and name', () => {
  const aligned = preserveCorrectedObjects(previous, generated);
  expect(aligned.topics.find(topic => topic.id === 'corrected-topic')?.name).toBe('用户修正名称');
});
```

Add a store integration assertion that a one-section MinerU change triggers one compiler batch and leaves unrelated topic IDs unchanged.

- [x] **Step 2: Run and verify failure**

Run: `pnpm test -- src/lib/course-structure/__tests__/incremental-reconcile.test.ts src/store/__tests__/mineru-reparse-increment.test.ts`

Expected: FAIL because canonical incremental reconciliation is missing.

- [x] **Step 3: Implement checkpoint reuse and corrected-object preservation**

Export:

```typescript
export function reconcileIncremental(previous: CourseLearningStructure | null, batches: SectionBatch[]): {
  reusable: Map<string, SectionCompilationCheckpoint>;
  reusedBatchIds: string[];
  changedBatchIds: string[];
}

export function preserveCorrectedObjects(previous: CourseLearningStructure | null, generated: CourseLearningStructure): CourseLearningStructure
```

Match checkpoints only by exact `cacheKey`. Preserve corrected topics by `stableKey`; preserve corrected order constraints when both endpoints still exist. Do not preserve corrected objects whose evidence no longer resolves—emit `INVALID_EVIDENCE` and degrade instead.

- [x] **Step 4: Add canonical structure to project state and snapshots**

In `src/types/index.ts`, add:

```typescript
import type { CourseLearningStructure } from '../lib/course-structure/types';

// ProjectState
courseLearningStructure: CourseLearningStructure | null;
```

Initialize it to `null` in the store. Add `courseLearningStructure` to `PERSISTED_PROJECT_FIELDS` and clone it through `library-repository.ts`. Keep workspace pointer schema 10 unchanged because the pointer format does not change.

- [x] **Step 5: Run persistence and incremental tests**

Run: `pnpm test -- src/lib/course-structure/__tests__/incremental-reconcile.test.ts src/store/__tests__/structure-extraction-persistence.test.ts src/store/__tests__/mineru-reparse-increment.test.ts`

Expected: PASS.

Run: `pnpm check`

Expected: exit 0.

- [x] **Step 6: Commit**

```bash
git add src/lib/course-structure/incremental-reconcile.ts src/lib/course-structure/__tests__/incremental-reconcile.test.ts src/types/index.ts src/lib/persistence.ts src/lib/library-repository.ts src/store/__tests__
git commit -m "feat: persist and reuse compiled course structures"
```

---

### Task 11: Switch the Main Pipeline and Separate Card Enrichment

**Files:**
- Modify: `src/lib/knowledge-pipeline-v2.ts`
- Modify: `src/types/index.ts`
- Modify: `src/store/useStore.ts`
- Modify: `src/lib/pipeline-progress.ts`
- Modify: `src/components/KnowledgeStructureView.tsx`
- Modify: `src/lib/__tests__/knowledge-pipeline-v2-cards.test.ts`
- Modify: `src/lib/__tests__/pipeline-progress.test.ts`
- Modify: `src/components/__tests__/KnowledgeStructureView.network.test.tsx`
- Add: `src/lib/__tests__/knowledge-pipeline-course-structure.test.ts`

- [x] **Step 1: Rewrite pipeline boundary tests before production code**

Update the card test expectations:

```typescript
expect(result.knowledgeCards.length).toBeGreaterThan(0);
expect(result.knowledgeCards.every(card => card.status !== 'generating')).toBe(true);
expect(mocks.callChatCompletion).not.toHaveBeenCalledWith(
  expect.anything(), expect.anything(), 'internal-structure', expect.anything(), expect.anything(), expect.anything(),
);
```

Add a new integration test that mocks `compileCourseStructure`, verifies `runKnowledgePipeline` stores the canonical structure, and verifies validation status controls `ready/degraded/failed`.

- [x] **Step 2: Run and verify the tests fail on the old pipeline**

Run: `pnpm test -- src/lib/__tests__/knowledge-pipeline-v2-cards.test.ts src/lib/__tests__/knowledge-pipeline-course-structure.test.ts src/lib/__tests__/pipeline-progress.test.ts`

Expected: FAIL because the old pipeline calls reconciliation, relation traversal, teaching extraction, and card enrichment.

- [x] **Step 3: Replace the structure stages in `runKnowledgePipeline`**

Modify `PipelineResultV2`:

```typescript
courseLearningStructure: CourseLearningStructure | null;
```

Extend `PipelineOptionsV2` explicitly so the store/compiler boundary is type-safe:

```typescript
previousStructure?: CourseLearningStructure | null;
onCompilerStage?: (stage: 'batching' | 'compiling' | 'normalizing' | 'reviewing' | 'scheduling' | 'validating') => void;
```

Add `'degraded'` to `V2PipelineStage`/`KnowledgePipelineStatus`. This is a first-class structure result, not an alias for success: the UI may remain usable while showing validation warnings.

After Markdown normalization:

```typescript
const canonical = await compileCourseStructure(config, sourceDocuments, courseId, {
  previous: options.previousStructure ?? null,
  onBatchProgress: options.onWindowProgress,
  onStage: stage => options.onCompilerStage?.(stage),
});
const projection = projectLegacyStructure(canonical, allBlocks);
const knowledgeCards = generateCards(
  projection.topics,
  projection.teachingBlocks,
  allBlocks,
  projection.topicRelations,
  projection.narrativePaths,
);
```

Do not call `enrichKnowledgeCards` inside `runKnowledgePipeline`. Preserve canonical status directly: `ready → ready`, `degraded → degraded`, `failed → failed`. Preserve base cards so the existing Cards stage can call `regenerateKnowledgeCards` for enrichment.

- [x] **Step 4: Store the canonical structure and previous structure input**

In `useStore.extractKnowledgeStructure`, pass the existing `courseLearningStructure` through options and store `result.courseLearningStructure`. For `degraded`, set `jobStatus: 'completed'` only when at least one verified topic exists, retain `knowledgePipelineStatus: 'degraded'`, and show a warning banner through `structureQuality.qualityIssues`. Update `KnowledgeStructureView` and its tests so `degraded` displays usable content plus the warning instead of the generic failure state.

- [x] **Step 5: Replace progress stages**

Use:

```typescript
export const STRUCTURE_EXTRACTION_STEPS = [
  { id: 'prepare-evidence', label: '准备原文证据', status: 'pending' },
  { id: 'compile-sections', label: '按章节提取两层结构', status: 'pending' },
  { id: 'normalize-topics', label: '归一课程知识', status: 'pending' },
  { id: 'review-curriculum', label: '审查课程结构', status: 'pending' },
  { id: 'schedule-course', label: '编译学习顺序', status: 'pending' },
  { id: 'validate-structure', label: '验证课程结构', status: 'pending' },
] as const;
```

Map compiler stages to these progress IDs and update range tests.

- [x] **Step 6: Run pipeline, store, and progress tests**

Run: `pnpm test -- src/lib/__tests__/knowledge-pipeline-v2-cards.test.ts src/lib/__tests__/knowledge-pipeline-course-structure.test.ts src/lib/__tests__/pipeline-progress.test.ts src/store/__tests__/structure-extraction-persistence.test.ts src/components/__tests__/KnowledgeStructureView.network.test.tsx`

Expected: PASS.

Run: `pnpm check`

Expected: exit 0.

- [x] **Step 7: Commit**

```bash
git add src/lib/knowledge-pipeline-v2.ts src/types/index.ts src/store/useStore.ts src/lib/pipeline-progress.ts src/components/KnowledgeStructureView.tsx src/lib/__tests__ src/store/__tests__/structure-extraction-persistence.test.ts src/components/__tests__/KnowledgeStructureView.network.test.tsx
git commit -m "feat: switch structure extraction to the course compiler"
```

---

### Task 12: Remove Legacy Extraction, Verify Performance, and Update Documentation

**Files:**
- Delete after reference scan: `src/lib/topic-extraction-v2.ts`
- Delete after reference scan: `src/lib/topic-reconciliation.ts`
- Delete after reference scan: `src/lib/knowledge-relation-traversal.ts`
- Delete after reference scan: `src/lib/teaching-structure.ts`
- Delete only tests dedicated to removed behavior.
- Modify: `README.md`
- Add: `src/lib/course-structure/__tests__/compiler-performance.test.ts`

- [x] **Step 1: Add the performance regression test**

Use a deterministic 12-section fixture and injected dependencies:

```typescript
it('does not add model calls per topic', async () => {
  let batchCalls = 0;
  let reviewCalls = 0;
  const result = await compileCourseStructure(config, documents, 'course', {
    compileBatch: async batch => { batchCalls += 1; return compilationWithManyTopics(batch); },
    review: async () => { reviewCalls += 1; return { operations: [], constraints: [], warnings: [] }; },
  });
  expect(result.topics.length).toBeGreaterThan(20);
  expect(batchCalls).toBe(buildSectionBatches(documents).length);
  expect(reviewCalls).toBe(1);
});
```

- [x] **Step 2: Run the performance test**

Run: `pnpm test -- src/lib/course-structure/__tests__/compiler-performance.test.ts`

Expected: PASS and no timeout.

- [x] **Step 3: Prove legacy production references are gone**

Run:

```bash
rg -n "topic-extraction-v2|topic-reconciliation|knowledge-relation-traversal|teaching-structure" src --glob '!**/*.test.ts'
```

Expected: no production references. If references remain in active source, migrate them before deletion. Do not delete compatibility types used by old snapshots.

- [x] **Step 4: Delete the unused legacy modules and dedicated tests**

Delete only after Step 3 returns no production references. Keep fixtures or tests that exercise shared public behavior by rewriting them against the new compiler.

- [x] **Step 5: Update README architecture and limitations**

Replace the old eight-stage text with:

```text
MinerU Markdown → 稳定证据片段 → 章节统一编译 → 课程知识归一
→ 学习顺序编译 → 两层课程结构 → 知识卡片/母笔记/问答
```

Document that the product builds a curriculum structure, not a generic knowledge graph; first-layer topics are independent learning goals, second-layer units explain them, and ordering is deterministic under explicit constraints.

- [x] **Step 6: Run the complete verification suite**

Run: `pnpm test`

Expected: all Vitest files pass.

Run: `pnpm check`

Expected: exit 0.

Run: `pnpm lint`

Expected: exit 0.

Run: `pnpm build`

Expected: TypeScript build and Vite production build succeed.

- [x] **Step 7: Inspect final model-call surface**

Run:

```bash
rg -n "callChatCompletion<|callChatCompletion\(" src/lib/course-structure src/lib/knowledge-pipeline-v2.ts
```

Expected: model calls exist only in `section-compiler.ts` and `curriculum-review.ts`; no call occurs in schedulers, validators, adapters, or per-topic loops.

- [x] **Step 8: Commit**

```bash
git add -A src README.md
git commit -m "refactor: retire repeated knowledge extraction passes"
```

---

## Final Acceptance Checklist

- [x] New courses produce exactly two knowledge layers.
- [x] First-layer topics have no parent-topic hierarchy.
- [x] One source block can support multiple topics through distinct or shared EvidenceSpans.
- [x] Hard ordering semantics are uniformly `before → after`.
- [x] Course order is deterministic and satisfies every retained hard constraint.
- [x] Teaching paths use controlled roles and deterministic templates.
- [x] Structure readiness does not wait for card enrichment or note generation.
- [x] Unchanged sections cause zero extraction calls on rerun.
- [x] Corrected topics and constraints survive incremental recompilation.
- [x] Legacy views, cards, notes, persistence, and QA pass regression tests.
- [x] Structure model-call count is exactly `uncached section batches + at most one curriculum review`, independent of topic count.
- [x] `getUsageRecords()` contains no per-topic structure task types after compilation; section/review token totals remain observable for later real-course comparison.
- [x] `pnpm test`, `pnpm check`, `pnpm lint`, and `pnpm build` all succeed.

---

## 验收记录（2026-08-31，真实课件）

> 对比环境：lecture1（Introduction to Machine Learning，69 页）还原为 24.7k 字符 Markdown / 263 块 / 44 章节；
> 模型 模力方舟 DeepSeek-V4-Flash（chat-completions）；新编译器跑 `codex/course-structure-compiler` 分支，
> 旧管线跑 `main` 分支，同一课件同一模型。完整数据见 `course_weave/real-courseware-validation/RESULTS.md`。

| 指标 | 旧管线 | 新编译器 | 验收目标 | 结论 |
|---|---|---|---|---|
| 结构阶段模型调用 | 48 | 6（4 批次 + 1 截断拆分重试 + 1 审查） | 减少 ≥60% | **-87.5%** ✅ |
| 结构阶段总 token | 213,325 | 50,004 | 减少 ≥50% | **-76.6%** ✅ |
| 结构阶段耗时 | 40.0 分钟 | 10.8 分钟 | -- | -73% |
| 相同课件二次运行 | 48 次全重跑 | 19 秒 / 0 次批次调用 | 未变化章节调用数为零 | ✅ |
| 调用数与主题数解耦 | 随 T 线性（35 次逐主题调用） | 仅随章节数 | 不含逐主题调用 | ✅ |

结构质量：17 个一级主题（仅 1 个课程事务类，旧管线 4 个）、53 个受控角色讲解单元、
98 个块内字符级证据 span（quote 实测与原文一致）、13 条方向统一顺序约束、二次运行学习
顺序完全一致；status=ready，仅 1 条 LOW_COVERAGE(36.5%) warning。

真实模型暴露并已修复的健壮性问题（提交 `7e39db4`）：

1. 响应 schema 未写入 prompt，模型自造字段名导致整批结果被静默丢弃（本次最严重问题）；
2. 批次预算 6000 低估 JSON 封装开销，输出撞 max_tokens 截断；预算统一降为 3000；
3. 截断/超时自动拆批此前仅 responses 模式启用，chat-completions 模式现已一致启用；
4. 批次调用成功但结果为空时无告警，新增 `EMPTY_SECTION_COMPILATION` issue；
5. 模型把 localId 写成数字时被静默丢弃，新增 `identifier()` 容错。

已知留观项：chat 模式 `callChatCompletion` 硬编码 120s 超时对慢模型（生成 7k token JSON 需
110-180s）偏紧，验证脚本中放宽到 10 分钟绕过；生产上可通过更小批次（已随预算调整）缓解。
