# Fast Two-Layer Course Compiler Design

## Purpose

Replace the current long-running section compiler with a bounded, progressive pipeline that preserves the product's original two-layer learning structure:

1. `LearningTopic` represents an independently learnable and testable course objective and participates in course-level learning order.
2. `TeachingUnit` represents a semantic teaching role inside one topic and participates in that topic's internal teaching order.

The course is a container, not a third knowledge layer. Source evidence is provenance for both layers, not a knowledge layer or a replacement for `TeachingUnit`.

## Problem

The current foreground request asks one model call to identify topics, generate teaching units, copy evidence quotes, infer local order, and return a large nested JSON document. A request may run until the proxy's 180-second timeout. The adaptive fallback then recursively splits the failed batch and executes child requests sequentially. Top-level progress advances only after the complete recursive tree finishes, so the interface can remain at `0 / N` for many minutes while its timer-driven percentage appears to move.

This is an architectural mismatch for an interactive product. Smaller timeouts alone do not solve it because the request still combines too many responsibilities and successful intermediate work is not made available immediately.

## Design Principles

- Preserve the two semantic learning layers.
- Keep source text immutable and independently verifiable.
- Use the model only for judgments that deterministic code cannot reliably make.
- Pre-split work before sending requests; never wait for a long request before deciding to split it.
- Persist every successful extraction unit immediately.
- Bound foreground work by per-request and whole-job deadlines.
- Produce a usable degraded structure from partial success.
- Keep learning order separate from generic semantic relations.
- Keep downstream knowledge cards, notes, retrieval, and UI consumers on the existing `CourseLearningStructure` contract.

## Considered Approaches

### A. Continue optimizing unified section requests

This has the smallest code change but retains large outputs, recursive recovery, and all-or-nothing section completion. It is rejected.

### B. Lightweight semantic extraction plus deterministic compilation

Small evidence units are processed independently. The model returns only topic mentions, teaching-role assignments, short source anchors, and explicit local order claims. Deterministic code validates evidence, normalizes topics, compiles both learning orders, and provides fallbacks. This is the selected design.

### C. Fully deterministic extraction

This is fast but cannot reliably distinguish independent learning objectives, aliases, or same-name concepts in different contexts. It remains a last-resort fallback, not the primary compiler.

## Canonical Model

The existing canonical types remain the public result. The foreground extraction layer adds smaller internal records.

### EvidenceAtom

```typescript
interface EvidenceAtom {
  id: string;
  documentId: string;
  sectionId: string;
  sourceBlockId: string;
  startOffset: number;
  endOffset: number;
  content: string;
  sourceType: MarkdownBlock['type'];
  sourceOrder: number;
  contentHash: string;
}
```

An atom is a bounded view over original MinerU content. It never replaces or mutates the source block. Multiple atoms may point to different ranges of the same block.

### ExtractionUnit

```typescript
interface ExtractionUnit {
  id: string;
  documentId: string;
  sectionIds: string[];
  atomIds: string[];
  estimatedTokens: number;
  cacheKey: string;
}
```

Units never cross document boundaries. The target input size is 600-1000 estimated tokens. Oversized blocks are atomized at paragraph, sentence, list-item, table-row, or formula boundaries before requests start.

### LightweightExtraction

```typescript
interface LightweightExtraction {
  unitId: string;
  topicMentions: Array<{
    localId: string;
    name: string;
    aliases: string[];
    learningObjective: string;
    genre: LearningGenre;
    difficulty: 1 | 2 | 3 | 4 | 5;
    importance: 'core' | 'important' | 'supplementary';
  }>;
  teachingUnits: Array<{
    localId: string;
    topicLocalId: string;
    role: TeachingRole;
    title: string;
    evidence: Array<{
      atomId: string;
      sourceBlockId: string;
      anchor: string;
    }>;
    required: boolean;
  }>;
  explicitOrders: Array<{
    beforeTopicLocalId: string;
    afterTopicLocalId: string;
    reason: string;
    evidence: Array<{
      atomId: string;
      sourceBlockId: string;
      anchor: string;
    }>;
  }>;
  confidence: number;
}
```

The model does not return full quotes, offsets, summaries, cross-course IDs, final topic order, or generic graph relations. Anchors are short exact substrings used by deterministic evidence resolution.

## Pipeline

### 1. Evidence preparation

Deterministic code derives sections and `EvidenceAtom` records from the existing `SourceDocument` and `MarkdownBlock` values. It preserves original document order and stable block IDs. This stage performs no model calls and should complete within two seconds for the representative 80-page course.

### 2. Unit scheduling

Atoms are packed into extraction units before any request starts. The foreground queue uses a concurrency limit of three. Each unit has one attempt in the foreground. Network setup failures and rate limits may be rescheduled only while the global deadline still leaves enough time; timeouts, truncated structured output, and invalid JSON are recorded for explicit retry rather than recursively splitting or repeating the same request.

Default budgets:

- 600-1000 estimated input tokens per unit.
- 1024 maximum output tokens per unit.
- 30-second request deadline.
- Three concurrent requests.
- 60-second local-extraction foreground budget.
- 90-second total foreground job deadline.

These values are versioned compiler configuration, not hidden constants in UI code.

### 3. Progressive checkpoints

Each successful unit is parsed, validated, and persisted immediately. Progress events include:

```typescript
interface ExtractionProgressEvent {
  completedUnits: number;
  successfulUnits: number;
  failedUnits: number;
  totalUnits: number;
  discoveredTopicMentions: number;
  elapsedMs: number;
}
```

The store retains explicit session state during a running job:

```typescript
interface ExtractionUnitCheckpoint {
  unitId: string;
  cacheKey: string;
  status: 'pending' | 'running' | 'succeeded' | 'failed';
  attempts: number;
  result?: LightweightExtraction;
  error?: string;
  completedAt?: number;
}

interface CourseExtractionSession {
  id: string;
  courseId: string;
  startedAt: number;
  deadlineAt: number;
  checkpoints: ExtractionUnitCheckpoint[];
}
```

Refreshing or resuming converts interrupted `running` checkpoints back to `pending` and schedules only pending and explicitly retried units. Succeeded checkpoints remain immutable until their cache key changes.

### 4. Evidence resolution

For every returned atom ID and anchor, deterministic code:

1. verifies that the atom and source block belong to the unit and correspond to each other;
2. searches only inside the atom's original source range;
3. accepts a unique exact match and converts atom-relative positions to original block offsets;
4. rejects missing or ambiguous matches with a structured issue;
5. creates the canonical `EvidenceSpan` from original content.

A teaching unit without valid evidence is not promoted to verified structure.

### 5. Topic normalization

The deterministic fast path merges candidates using normalized names, aliases, objective similarity, evidence overlap, and section context. Same-name candidates with incompatible objectives or contexts remain separate. Only ambiguous candidate groups are eligible for a compact model adjudication.

Normalization is re-run incrementally as checkpoints arrive, but canonical stable keys are finalized only when the foreground queue closes or the user chooses to use the current result.

### 6. Compact curriculum adjudication

One optional course-level request sees only canonical candidate IDs, names, objectives, genres, importance, source order, and short evidence anchors. It may return:

- merge or keep-separate operations;
- demotion of an overly narrow topic mention to an existing teaching unit;
- prerequisite pairs between existing topic IDs;
- short reasons that reference only existing IDs.

It cannot create evidence-free topics or rewrite teaching content. Its deadline is 20 seconds and its output limit is 1536 tokens. Failure never blocks compilation; deterministic normalization and scheduling continue. An unresolved ambiguity degrades the result when the candidates share a normalized name or learning objective but deterministic rules cannot safely merge or separate them.

### 7. Course-order compilation

Course order is compiled from explicit evidence-backed hard constraints plus inferred soft constraints. The stable scheduler prioritizes:

1. hard prerequisites;
2. satisfied soft prerequisites;
3. core importance and foundational difficulty;
4. section continuity;
5. smaller difficulty jumps;
6. original source order;
7. stable key as the final tie-breaker.

Model-inferred constraints are soft unless an exact source anchor explicitly states the dependency. Cycles follow the existing corrected/explicit/inferred removal policy.

### 8. Teaching-path compilation

The model identifies teaching roles but does not generate the final internal order. The existing genre templates compile each topic's teaching path. Units with the same role are ordered by explicit local claims, then source order, then stable key. Missing roles do not produce synthetic nodes.

The canonical second layer therefore remains semantic:

```text
TeachingRole + short label + verified EvidenceSpan
```

It is neither a raw block list nor generated prose.

### 9. Validation and publication

When all foreground units settle, the global deadline is reached, or the user chooses to stop and use current results, the compiler publishes the best safe structure.

- `ready`: every non-empty extraction unit succeeded, all required teaching units have evidence, and hard order is valid.
- `degraded`: useful topics exist but at least one extraction unit is pending or failed, or same-name/same-objective candidates remain unresolved.
- `failed`: no valid learning topic can be formed or the canonical model is unsafe to publish.

The job never discards successful checkpoints because another unit failed.

## Cache and Resume

An extraction-unit cache key includes:

- atom content hashes;
- extraction prompt version;
- compiler configuration version;
- API mode and model identity.

Changing the model or prompt must not silently reuse incompatible results. The curriculum-adjudication cache is keyed by the ordered canonical candidate signatures and adjudication prompt version.

Unchanged units perform zero model calls on rerun. Failed units can be retried individually without clearing successful results.

## User Experience

The foreground view uses real stages and counters:

```text
✓ 整理原文证据
● 识别两层知识  9/16
○ 合并知识点与学习顺序
○ 校验课程结构
```

The view shows successful, failed, and total units; discovered topic count; elapsed time; and the current real operation. It does not advance a timer-driven fake percentage.

Once at least one valid topic exists, the interface shows a clearly labelled draft preview containing discovered topic names and teaching-unit counts. Canonical stable IDs are not published until compilation closes. The user can:

- stop and use the current safe result;
- continue processing in the foreground;
- retry only failed units;
- resume after refresh.

The initial version does not continue remote requests after the browser is closed. Resume uses persisted checkpoints.

## Compatibility

The final output remains `CourseLearningStructure`. Existing adapters continue producing `KnowledgeTopic`, `TeachingBlock`, `CourseLearningPath`, cards, notes, and retrieval records. The refactor replaces upstream batching, extraction, progress, and checkpoint persistence without introducing a third knowledge layer or changing downstream ownership.

Existing user corrections and stable identities remain protected by incremental reconciliation. A corrected topic or order constraint is never overwritten by a lower-priority inferred result.

## Module Boundaries

```text
course-structure/
├── evidence-atomizer.ts          original block -> stable evidence atoms
├── extraction-unit-builder.ts    atoms -> bounded request units
├── lightweight-extractor.ts      one model request and response parsing
├── extraction-runner.ts         queue, deadlines, abort, progress events
├── extraction-checkpoints.ts    cache keys and resumable unit state
├── evidence-span.ts             anchor validation and canonical spans
├── candidate-normalizer.ts      deterministic cross-unit normalization
├── curriculum-review.ts         compact optional adjudication
├── course-scheduler.ts          deterministic first-layer order
├── teaching-path-compiler.ts    deterministic second-layer order
└── compiler.ts                  orchestration and canonical publication
```

Each module owns one responsibility and can be tested without the UI or live model service.

## Error Handling

- A timed-out unit becomes a structured failed checkpoint; it is not recursively split during the running job.
- Invalid IDs, roles, anchors, and operations are rejected at the boundary that receives them.
- Rate-limit and network retries respect remaining global time and never exceed one reschedule per unit.
- Closing or cancelling the job aborts in-flight requests and preserves completed checkpoints.
- Optional curriculum adjudication failure falls back to deterministic output.
- Failed-unit details remain visible and retryable after degraded publication.

## Testing

### Pure functions

- Oversized blocks atomize at safe boundaries while preserving original IDs and offsets.
- One source block can support multiple topics through distinct evidence ranges.
- Unit packing respects document boundaries and token budgets.
- Unique anchors resolve to exact original ranges; ambiguous anchors are rejected.
- Topic normalization is input-order independent.
- Course and teaching-path compilation remain deterministic.

### Runner behavior

- Requests never start with inputs above the configured unit budget.
- Concurrency never exceeds three.
- A timed-out unit is recorded once and does not create recursive child requests.
- Checkpoints are emitted and persisted as individual units finish.
- Cancellation aborts in-flight work without losing successful checkpoints.
- Global deadline publishes a degraded result instead of waiting indefinitely.
- Rerunning unchanged content makes zero extraction calls.
- Changing the model invalidates incompatible checkpoints.

### Integration

- An 80-page fixture exposes real `completed / total` progress.
- Partial extraction produces a browsable degraded two-layer structure.
- Every verified topic and teaching unit resolves to original MinerU evidence.
- A block containing two knowledge points produces two valid semantic bindings.
- Curriculum-review timeout still yields deterministic order.
- Existing network, cards, notes, persistence, and retrieval tests continue passing.

## Acceptance Criteria

1. No foreground extraction request waits longer than 30 seconds.
2. No timeout triggers recursive splitting or identical automatic replay.
3. The full foreground job stops scheduling model work by 90 seconds.
4. The progress UI reports real unit counts and elapsed time.
5. Successful units survive refresh, cancellation, and unrelated unit failure.
6. A partial but valid result is published as degraded rather than failed.
7. First-layer topics retain independent learning objectives and course-level order.
8. Second-layer teaching units retain semantic roles, verified evidence, and internal teaching order.
9. Course and teaching order are deterministic for identical canonical inputs.
10. Unchanged reruns make zero extraction calls.
11. Downstream cards, notes, knowledge network, and QA continue consuming the existing canonical structure.

## Non-Goals

- Building a generic knowledge graph or graph database.
- Adding a third knowledge layer.
- Generating long card or note prose during structure compilation.
- Running browser-closed background jobs in the first version.
- Automatically accepting evidence-free model knowledge.
- Guaranteeing complete coverage when the configured model cannot answer within the product deadline.
