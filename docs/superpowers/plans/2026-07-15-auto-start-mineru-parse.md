# Automatic MinerU Parse Entry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the preview-page “进入 MinerU 解析” action start parsing immediately, including a configuration-save continuation when MinerU is not configured.

**Architecture:** `App` owns the temporary configuration intent and the single parse-launch function. `DocumentReviewWorkspace` remains presentation-focused and requests that launch through an async callback; `SettingsModal` gains an explicit resume-MinerU mode and reports validated saved configuration back to `App`. The store remains the source of truth for parse progress and errors.

**Tech Stack:** React 18, TypeScript, Zustand, Vitest, React DOM test utilities, existing MinerU client and persistence modules.

---

## File Map

- Modify `src/components/document-review/DocumentReviewWorkspace.tsx`: accept an async launch callback and disable the button while it is pending.
- Modify `src/components/document-review/ReviewToolbar.tsx`: support a pending label and disabled state.
- Modify `src/components/ParseReviewView.tsx`: pass the existing store launch action through the legacy wrapper.
- Create `src/components/document-review/__tests__/DocumentReviewWorkspace.test.tsx`: ensure one launch request and pending-button behavior.
- Modify `src/components/SettingsModal.tsx`: add resume-MinerU mode, validation, and save callback.
- Create `src/components/__tests__/SettingsModal.test.tsx`: validate normal and resume-mode behavior.
- Modify `src/App.tsx`: coordinate configured launch, pending configuration, cancellation, and resume.
- Modify `src/components/__tests__/LibraryNavigation.test.tsx`: integration coverage for App-level configuration continuation.

## Task 1: Make the preview action asynchronous and single-submit

**Files:**
- Modify: `src/components/document-review/DocumentReviewWorkspace.tsx`
- Modify: `src/components/document-review/ReviewToolbar.tsx`
- Create: `src/components/document-review/__tests__/DocumentReviewWorkspace.test.tsx`

- [ ] **Step 1: Write the failing workspace action test**

Mock the expensive preview children and render a one-page PDF document:

```tsx
import { act, createElement, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../../../store/useStore';
import { DocumentReviewWorkspace } from '../DocumentReviewWorkspace';

vi.mock('../PdfPreview', () => ({ PdfPreview: () => createElement('div', null, 'PDF preview') }));
vi.mock('../PageNavigator', () => ({ PageNavigator: () => createElement('div', null, 'pages') }));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: Root[] = [];

beforeEach(() => {
  act(() => useStore.setState({
    stage: 'document',
    document: {
      id: 'doc-1', courseId: 'course-1', title: 'lecture', fileName: 'lecture.pdf',
      fileType: 'pdf', sourceKey: 'source-1', uploadedAt: 0,
      pages: [{ pageNumber: 1, text: 'page' }],
    },
    sourceDocuments: [],
    mineruConfig: { endpoint: 'https://mineru.example.com', apiKey: 'token', modelVersion: 'vlm', language: 'ch', enableFormula: true, enableTable: true },
  }));
});

afterEach(() => {
  act(() => roots.splice(0).forEach(root => root.unmount()));
  document.body.innerHTML = '';
});

function renderWorkspace(onRequestMinerUParse: () => Promise<void>) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(createElement(DocumentReviewWorkspace, { onRequestMinerUParse })));
  return container;
}

describe('DocumentReviewWorkspace MinerU entry', () => {
  it('submits the launch once and disables the entry while pending', async () => {
    let resolve!: () => void;
    const onRequestMinerUParse = vi.fn(() => new Promise<void>(done => { resolve = done; }));
    const container = renderWorkspace(onRequestMinerUParse);
    const entry = Array.from(container.querySelectorAll('button')).find(button => button.textContent?.includes('进入 MinerU 解析'))!;

    await act(async () => { entry.click(); });
    expect(onRequestMinerUParse).toHaveBeenCalledTimes(1);
    expect(entry.disabled).toBe(true);
    expect(entry.textContent).toContain('正在进入');

    act(() => entry.click());
    expect(onRequestMinerUParse).toHaveBeenCalledTimes(1);
    await act(async () => resolve());
  });
});
```

- [ ] **Step 2: Run the test and confirm failure**

```bash
./node_modules/.bin/vitest run src/components/document-review/__tests__/DocumentReviewWorkspace.test.tsx
```

Expected: FAIL because `DocumentReviewWorkspace` does not accept `onRequestMinerUParse` and the toolbar cannot disable the action.

- [ ] **Step 3: Add the async callback boundary**

In `DocumentReviewWorkspace.tsx`:

```tsx
interface DocumentReviewWorkspaceProps {
  onRequestMinerUParse: () => Promise<void>;
}

export function DocumentReviewWorkspace({ onRequestMinerUParse }: DocumentReviewWorkspaceProps) {
  // existing state
  const handleConfirm = useCallback(async () => {
    if (isConfirming) return;
    setIsConfirming(true);
    try {
      await onRequestMinerUParse();
    } finally {
      setIsConfirming(false);
    }
  }, [isConfirming, onRequestMinerUParse]);
```

Remove the now-unused `navigateToStage('mineru')` call from `handleConfirm`, but retain `navigateToStage` for back navigation.

Pass the pending state to the toolbar:

```tsx
<ReviewToolbar
  // existing props
  onConfirm={handleConfirm}
  isConfirming={isConfirming}
/>
```

In `ReviewToolbar.tsx`, extend the props and button:

```tsx
interface ReviewToolbarProps {
  // existing props
  isConfirming: boolean;
}

<button
  onClick={onConfirm}
  disabled={isConfirming}
  className="btn-primary px-4 py-1.5 disabled:cursor-wait disabled:opacity-60"
>
  {isConfirming ? '正在进入...' : '进入 MinerU 解析'}
</button>
```

For the Markdown preview branch, reuse `handleConfirm` and its `isConfirming` label exactly as before.

Update the legacy wrapper in `ParseReviewView.tsx` so TypeScript has a valid callback:

```tsx
import { useStore } from '../store/useStore';
import { DocumentReviewWorkspace } from './document-review/DocumentReviewWorkspace';

export function ParseReviewView() {
  const startMinerUParse = useStore(state => state.startMinerUParse);
  return <DocumentReviewWorkspace onRequestMinerUParse={startMinerUParse} />;
}
```

- [ ] **Step 4: Run the focused test**

Run the command from Step 2.

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/document-review/DocumentReviewWorkspace.tsx src/components/document-review/ReviewToolbar.tsx src/components/document-review/__tests__/DocumentReviewWorkspace.test.tsx src/components/ParseReviewView.tsx
git commit -m "Make the MinerU preview entry single-submit"
```

## Task 2: Add validated save-and-resume behavior to settings

**Files:**
- Modify: `src/components/SettingsModal.tsx`
- Create: `src/components/__tests__/SettingsModal.test.tsx`

- [ ] **Step 1: Write failing resume-mode tests**

Create tests that render the modal against the real Zustand store:

```tsx
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../../store/useStore';
import { SettingsModal } from '../SettingsModal';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: Root[] = [];

beforeEach(() => act(() => useStore.setState({ mineruConfig: null, modelConfig: null })));
afterEach(() => {
  act(() => roots.splice(0).forEach(root => root.unmount()));
  document.body.innerHTML = '';
});

function renderModal(props: Partial<ComponentProps<typeof SettingsModal>> = {}) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  const onClose = vi.fn();
  const onSaved = vi.fn();
  act(() => root.render(createElement(SettingsModal, { isOpen: true, onClose, onSaved, mode: 'resume-mineru', ...props })));
  return { container, onClose, onSaved };
}

function setInput(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => { setter.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); });
}

describe('SettingsModal MinerU continuation', () => {
  it('keeps the modal open until MinerU credentials are valid', () => {
    const { container, onClose, onSaved } = renderModal();
    const save = Array.from(container.querySelectorAll('button')).find(button => button.textContent === '保存并开始解析')!;
    act(() => save.click());
    expect(container.textContent).toContain('请填写 MinerU API 地址和 Token');
    expect(onClose).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('saves valid MinerU configuration and reports readiness', () => {
    const { container, onClose, onSaved } = renderModal();
    const inputs = container.querySelectorAll<HTMLInputElement>('input');
    setInput(inputs[1], 'token');
    const save = Array.from(container.querySelectorAll('button')).find(button => button.textContent === '保存并开始解析')!;
    act(() => save.click());
    expect(useStore.getState().mineruConfig?.apiKey).toBe('token');
    expect(onSaved).toHaveBeenCalledWith({ mineruConfigured: true });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run and confirm failure**

```bash
./node_modules/.bin/vitest run src/components/__tests__/SettingsModal.test.tsx
```

Expected: FAIL because `mode`, `onSaved`, validation copy, and resume label do not exist.

- [ ] **Step 3: Implement explicit settings mode**

Extend props and add local validation state:

```tsx
interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  mode?: 'default' | 'resume-mineru';
  onSaved?: (result: { mineruConfigured: boolean }) => void;
}

export function SettingsModal({ isOpen, onClose, mode = 'default', onSaved }: SettingsModalProps) {
  // existing store and form state
  const [mineruError, setMineruError] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    setMineru(storedMinerU ?? DEFAULT_MINERU);
    setModel(storedModel ?? DEFAULT_MODEL);
    setMineruError('');
  }, [isOpen, storedMinerU, storedModel]);

  const save = () => {
    const endpoint = mineru.endpoint.trim();
    const apiKey = mineru.apiKey.trim();
    const nextMinerU = endpoint && apiKey ? { ...mineru, endpoint, apiKey } : null;
    if (mode === 'resume-mineru' && !nextMinerU) {
      setMineruError('请填写 MinerU API 地址和 Token');
      return;
    }
    setMinerUConfig(nextMinerU);
    setModelConfig(model.apiKey.trim() ? { ...model, endpoint: model.endpoint.trim(), model: model.model.trim(), apiKey: model.apiKey.trim() } : null);
    onSaved?.({ mineruConfigured: Boolean(nextMinerU) });
    onClose();
  };
```

Render the error immediately below the MinerU fields:

```tsx
{mineruError && <p role="alert" className="mt-3 rounded-lg border border-cinnabar/25 bg-cinnabar/10 px-3 py-2 text-sm text-cinnabar-light">{mineruError}</p>}
```

Change the save label only in resume mode:

```tsx
<button className="btn-primary" onClick={save}>
  {mode === 'resume-mineru' ? '保存并开始解析' : '保存配置'}
</button>
```

- [ ] **Step 4: Run focused and existing settings-related tests**

```bash
./node_modules/.bin/vitest run src/components/__tests__/SettingsModal.test.tsx src/components/__tests__/MinerUParseView.test.tsx
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/SettingsModal.tsx src/components/__tests__/SettingsModal.test.tsx
git commit -m "Add save-and-resume MinerU settings"
```

## Task 3: Coordinate configured, unconfigured, Markdown, and cancel flows in App

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/__tests__/LibraryNavigation.test.tsx`

- [ ] **Step 1: Add failing App integration tests**

Add a helper that places App on a previewable document:

```tsx
function prepareDocument(configured: boolean) {
  act(() => useStore.setState({
    stage: 'document',
    document: {
      id: 'doc-1', courseId: 'course-1', title: 'lecture', fileName: 'lecture.pdf', fileType: 'pdf',
      sourceKey: 'source-1', uploadedAt: 0, pages: [{ pageNumber: 1, text: 'page' }],
    },
    sourceDocuments: [],
    mineruParseResult: null,
    mineruConfig: configured ? { endpoint: 'https://mineru.example.com', apiKey: 'token', modelVersion: 'vlm', language: 'ch', enableFormula: true, enableTable: true } : null,
  }));
  act(() => useLibraryStore.setState({ screen: 'workspace' }));
}
```

Mock only the store action, not the UI:

```tsx
it('starts MinerU immediately when preview credentials already exist', async () => {
  prepareDocument(true);
  const startMinerUParse = vi.fn(async () => useStore.setState({ stage: 'mineru' }));
  act(() => useStore.setState({ startMinerUParse }));
  await act(async () => root!.render(createElement(App)));
  await act(async () => button('进入 MinerU 解析').click());
  expect(startMinerUParse).toHaveBeenCalledTimes(1);
  expect(useStore.getState().stage).toBe('mineru');
});

it('opens settings and resumes once after valid MinerU configuration', async () => {
  prepareDocument(false);
  const startMinerUParse = vi.fn(async () => useStore.setState({ stage: 'mineru' }));
  act(() => useStore.setState({ startMinerUParse }));
  await act(async () => root!.render(createElement(App)));
  await act(async () => button('进入 MinerU 解析').click());
  expect(container!.textContent).toContain('保存并开始解析');
  expect(startMinerUParse).not.toHaveBeenCalled();

  const token = container!.querySelector<HTMLInputElement>('input[placeholder="MinerU Token"]')!;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => { setter.call(token, 'token'); token.dispatchEvent(new Event('input', { bubbles: true })); });
  await act(async () => button('保存并开始解析').click());
  expect(startMinerUParse).toHaveBeenCalledTimes(1);
});

it('clears the pending parse when settings are cancelled', async () => {
  prepareDocument(false);
  const startMinerUParse = vi.fn();
  act(() => useStore.setState({ startMinerUParse }));
  await act(async () => root!.render(createElement(App)));
  await act(async () => button('进入 MinerU 解析').click());
  await act(async () => button('取消').click());
  expect(startMinerUParse).not.toHaveBeenCalled();
  await act(async () => button('服务配置').click());
  expect(container!.textContent).toContain('保存配置');
  expect(container!.textContent).not.toContain('保存并开始解析');
});
```

If the existing test `button()` helper requires exact text, keep the labels exactly as specified.

- [ ] **Step 2: Run integration tests and confirm failure**

```bash
./node_modules/.bin/vitest run src/components/__tests__/LibraryNavigation.test.tsx
```

Expected: FAIL because App has no pending intent or immediate parse orchestration.

- [ ] **Step 3: Implement App orchestration**

Add store selectors and local intent:

```tsx
const mineruConfig = useStore(s => s.mineruConfig);
const document = useStore(s => s.document);
const startMinerUParse = useStore(s => s.startMinerUParse);
const [settingsIntent, setSettingsIntent] = useState<'default' | 'resume-mineru'>('default');

const closeSettings = () => {
  setSettingsOpen(false);
  setSettingsIntent('default');
};

const openDefaultSettings = () => {
  setSettingsIntent('default');
  setSettingsOpen(true);
};

const requestMinerUParse = async () => {
  const directMarkdown = document?.fileType === 'markdown';
  if (directMarkdown || mineruConfig?.apiKey) {
    await startMinerUParse();
    return;
  }
  setSettingsIntent('resume-mineru');
  setSettingsOpen(true);
};

const handleSettingsSaved = async ({ mineruConfigured }: { mineruConfigured: boolean }) => {
  if (settingsIntent !== 'resume-mineru' || !mineruConfigured) return;
  setSettingsIntent('default');
  await useStore.getState().startMinerUParse();
};
```

Use `openDefaultSettings` for Home, QA, Sidebar, MinerU, Structure, and Notes. Render the document stage as:

```tsx
case 'document':
  return <DocumentReviewWorkspace onRequestMinerUParse={requestMinerUParse} />;
```

Render every `SettingsModal` instance with the same explicit callbacks:

```tsx
<SettingsModal
  isOpen={settingsOpen}
  mode={settingsIntent}
  onSaved={handleSettingsSaved}
  onClose={closeSettings}
/>
```

`SettingsModal.save()` writes Zustand synchronously before `onSaved`, so `useStore.getState().startMinerUParse()` observes the new MinerU configuration.

- [ ] **Step 4: Run all focused MinerU tests**

```bash
./node_modules/.bin/vitest run src/components/document-review/__tests__/DocumentReviewWorkspace.test.tsx src/components/__tests__/SettingsModal.test.tsx src/components/__tests__/MinerUParseView.test.tsx src/components/__tests__/LibraryNavigation.test.tsx src/lib/__tests__/workflow-mineru.test.ts
```

Expected: all focused tests PASS; the configured and continuation cases each call parsing once.

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx src/components/__tests__/LibraryNavigation.test.tsx
git commit -m "Start MinerU directly from course preview"
```

## Task 4: Verify error behavior and full regressions

**Files:**
- Modify: `src/components/__tests__/LibraryNavigation.test.tsx`

- [ ] **Step 1: Add a no-auto-retry assertion**

In the App integration tests, make `startMinerUParse` set a failed result and assert it remains one call after React settles:

```tsx
const startMinerUParse = vi.fn(async () => useStore.setState({
  stage: 'mineru',
  mineruParseResult: { status: 'failed', progress: 0, assets: [], sourceFileName: 'lecture.pdf', error: 'network failed' },
}));
act(() => useStore.setState({ startMinerUParse }));
await act(async () => button('进入 MinerU 解析').click());
await act(async () => {});
expect(startMinerUParse).toHaveBeenCalledTimes(1);
expect(container!.textContent).toContain('network failed');
```

- [ ] **Step 2: Run focused tests**

Run the Task 3 Step 4 command.

Expected: all PASS.

- [ ] **Step 3: Run full static and production verification**

```bash
./node_modules/.bin/vitest run --exclude '.pnpm-store/**' --exclude '.worktrees/**'
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/eslint .
./node_modules/.bin/vite build
```

Expected: all tests PASS, TypeScript exit 0, ESLint 0 errors, Vite build exit 0.

- [ ] **Step 4: Verify the live workflow**

At desktop and mobile widths:

1. With a configured MinerU Token, upload a PDF/PPTX, preview it, click “进入 MinerU 解析”, and confirm progress begins without another click.
2. Clear MinerU config, repeat, and confirm the settings modal says “保存并开始解析”.
3. Cancel and confirm the preview remains and parsing does not begin.
4. Reopen the flow, save valid configuration, and confirm progress starts exactly once.
5. Simulate or observe a failure and confirm the page offers manual “重新解析” without looping.

- [ ] **Step 5: Commit the failure regression test**

```bash
git add src/components/__tests__/LibraryNavigation.test.tsx
git commit -m "Cover automatic MinerU launch failure"
```
