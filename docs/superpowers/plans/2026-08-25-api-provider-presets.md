# API Provider Presets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a provider selector and official API Key shortcuts to the knowledge-generation settings section while preserving editable OpenAI-compatible configuration and existing storage.

**Architecture:** Keep provider metadata and endpoint matching in a new pure `model-providers` module. `SettingsModal` owns only the selected provider UI state, applies presets to the existing `ModelConfig`, and keeps the stored schema unchanged. Unit tests cover the catalog and matching logic; component tests cover user interaction and regression behavior.

**Tech Stack:** React 18, TypeScript, Zustand, Tailwind CSS, Vitest, jsdom, pnpm

---

## File map

- Create `src/lib/model-providers.ts`: provider IDs, official endpoints, current default models, API Key links, hints, and endpoint matching.
- Create `src/lib/__tests__/model-providers.test.ts`: pure catalog and endpoint-normalization tests.
- Modify `src/components/SettingsModal.tsx`: provider state, selector, preset application, official link, current DeepSeek default, and responsive labels.
- Modify `src/components/__tests__/SettingsModal.test.tsx`: provider selection, ModelArk, manual override, stored endpoint recognition, link security, and unchanged saved schema.

No store, type, persistence, MinerU, pipeline, or other page files should change.

### Task 1: Provider catalog and endpoint matching

**Files:**
- Create: `src/lib/model-providers.ts`
- Create: `src/lib/__tests__/model-providers.test.ts`

- [ ] **Step 1: Write the failing catalog tests**

Create `src/lib/__tests__/model-providers.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import {
  CUSTOM_MODEL_PROVIDER_ID,
  MODEL_PROVIDER_PRESETS,
  findModelProviderByEndpoint,
} from '../model-providers';

describe('model provider presets', () => {
  it('contains the nine approved providers in the intended order', () => {
    expect(MODEL_PROVIDER_PRESETS.map(provider => provider.id)).toEqual([
      'deepseek',
      'aliyun-bailian',
      'modelark',
      'zhipu',
      'kimi',
      'volcengine-ark',
      'siliconflow',
      'openai',
      'openrouter',
    ]);
    expect(CUSTOM_MODEL_PROVIDER_ID).toBe('custom');
  });

  it('keeps ModelArk as a first-class official provider', () => {
    const modelark = MODEL_PROVIDER_PRESETS.find(provider => provider.id === 'modelark');

    expect(modelark).toMatchObject({
      label: '模力方舟（Gitee AI）',
      endpoint: 'https://ai.gitee.com/v1',
      defaultModel: 'GLM-5',
      apiKeyUrl: 'https://ai.gitee.com/products/apis',
    });
  });

  it('uses the current DeepSeek model instead of the retired alias', () => {
    expect(MODEL_PROVIDER_PRESETS[0]).toMatchObject({
      id: 'deepseek',
      endpoint: 'https://api.deepseek.com',
      defaultModel: 'deepseek-v4-flash',
    });
  });

  it('matches saved endpoints while ignoring whitespace and trailing slashes', () => {
    expect(findModelProviderByEndpoint('  https://api.deepseek.com///  ')?.id).toBe('deepseek');
    expect(findModelProviderByEndpoint('https://AI.GITEE.COM/v1/')?.id).toBe('modelark');
  });

  it('does not misidentify custom compatible endpoints', () => {
    expect(findModelProviderByEndpoint('https://models.example.com/v1')).toBeUndefined();
    expect(findModelProviderByEndpoint('')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the focused test and confirm the expected failure**

Run:

```bash
pnpm test -- src/lib/__tests__/model-providers.test.ts
```

Expected: FAIL because `../model-providers` does not exist.

- [ ] **Step 3: Implement the provider catalog and matching helper**

Create `src/lib/model-providers.ts`:

```typescript
export type ModelProviderId =
  | 'deepseek'
  | 'aliyun-bailian'
  | 'modelark'
  | 'zhipu'
  | 'kimi'
  | 'volcengine-ark'
  | 'siliconflow'
  | 'openai'
  | 'openrouter';

export const CUSTOM_MODEL_PROVIDER_ID = 'custom' as const;
export type ModelProviderSelection = ModelProviderId | typeof CUSTOM_MODEL_PROVIDER_ID;

export interface ModelProviderPreset {
  id: ModelProviderId;
  label: string;
  endpoint: string;
  defaultModel: string;
  apiKeyUrl: string;
  hint: string;
}

export const MODEL_PROVIDER_PRESETS: readonly ModelProviderPreset[] = [
  {
    id: 'deepseek',
    label: 'DeepSeek',
    endpoint: 'https://api.deepseek.com',
    defaultModel: 'deepseek-v4-flash',
    apiKeyUrl: 'https://platform.deepseek.com/api_keys',
    hint: '默认使用 DeepSeek V4 Flash；模型名称仍可手动修改。',
  },
  {
    id: 'aliyun-bailian',
    label: '阿里云百炼',
    endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    defaultModel: 'qwen-plus',
    apiKeyUrl: 'https://bailian.console.aliyun.com/?apiKey=1#/api-key',
    hint: '默认使用中国大陆兼容地址；工作空间专属地址可手动覆盖。',
  },
  {
    id: 'modelark',
    label: '模力方舟（Gitee AI）',
    endpoint: 'https://ai.gitee.com/v1',
    defaultModel: 'GLM-5',
    apiKeyUrl: 'https://ai.gitee.com/products/apis',
    hint: '登录模力方舟后可进入 Serverless API 控制台获取密钥。',
  },
  {
    id: 'zhipu',
    label: '智谱 BigModel',
    endpoint: 'https://open.bigmodel.cn/api/paas/v4',
    defaultModel: 'glm-5.2',
    apiKeyUrl: 'https://open.bigmodel.cn/usercenter/apikeys',
    hint: '默认使用智谱通用 OpenAI-compatible API。',
  },
  {
    id: 'kimi',
    label: 'Kimi',
    endpoint: 'https://api.moonshot.cn/v1',
    defaultModel: 'kimi-k2.6',
    apiKeyUrl: 'https://platform.kimi.com/console/api-keys',
    hint: '默认使用 Kimi 当前通用模型；可按控制台模型列表修改。',
  },
  {
    id: 'volcengine-ark',
    label: '火山方舟',
    endpoint: 'https://ark.cn-beijing.volces.com/api/v3',
    defaultModel: 'doubao-seed-2-0-lite-260215',
    apiKeyUrl: 'https://console.volcengine.com/ark/region:ark+cn-beijing/apikey',
    hint: '默认使用北京地域 API；其他地域或接入点可手动覆盖。',
  },
  {
    id: 'siliconflow',
    label: '硅基流动',
    endpoint: 'https://api.siliconflow.cn/v1',
    defaultModel: 'deepseek-ai/DeepSeek-V4-Flash',
    apiKeyUrl: 'https://cloud.siliconflow.cn/account/ak',
    hint: '模型标识以硅基流动模型广场为准，可随时手动修改。',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    endpoint: 'https://api.openai.com/v1',
    defaultModel: 'gpt-5-mini',
    apiKeyUrl: 'https://platform.openai.com/api-keys',
    hint: '默认使用成本较低的 GPT-5 mini，模型名称可手动修改。',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    endpoint: 'https://openrouter.ai/api/v1',
    defaultModel: '~openai/gpt-latest',
    apiKeyUrl: 'https://openrouter.ai/settings/keys',
    hint: 'OpenRouter 支持多家模型；可把模型名称改为任意有效 slug。',
  },
] as const;

function normalizeEndpoint(endpoint: string) {
  return endpoint.trim().replace(/\/+$/, '').toLowerCase();
}

export function findModelProviderByEndpoint(endpoint: string) {
  const normalized = normalizeEndpoint(endpoint);
  if (!normalized) return undefined;
  return MODEL_PROVIDER_PRESETS.find(provider => normalizeEndpoint(provider.endpoint) === normalized);
}
```

- [ ] **Step 4: Run the focused test and confirm it passes**

Run:

```bash
pnpm test -- src/lib/__tests__/model-providers.test.ts
```

Expected: PASS with 5 passing tests.

- [ ] **Step 5: Commit the provider module**

```bash
git add src/lib/model-providers.ts src/lib/__tests__/model-providers.test.ts
git commit -m "feat: add API provider presets"
```

### Task 2: Provider selector and official API Key shortcut

**Files:**
- Modify: `src/components/SettingsModal.tsx:1-230`
- Modify: `src/components/__tests__/SettingsModal.test.tsx:1-90`

- [ ] **Step 1: Add the select-event test helper**

Add this helper immediately after `setInput` in `src/components/__tests__/SettingsModal.test.tsx`:

```typescript
function setSelect(select: HTMLSelectElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(select, value);
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}
```

- [ ] **Step 2: Write failing component tests for the approved interaction**

Append this describe block to `src/components/__tests__/SettingsModal.test.tsx`:

```typescript
describe('SettingsModal model provider presets', () => {
  it('renders all approved providers and the current DeepSeek default', () => {
    const { container } = renderModal({ mode: 'default' });
    const provider = container.querySelector<HTMLSelectElement>('select[aria-label="API 平台"]')!;

    expect(Array.from(provider.options).map(option => option.textContent)).toEqual([
      'DeepSeek',
      '阿里云百炼',
      '模力方舟（Gitee AI）',
      '智谱 BigModel',
      'Kimi',
      '火山方舟',
      '硅基流动',
      'OpenAI',
      'OpenRouter',
      '自定义',
    ]);
    expect(provider.value).toBe('deepseek');
    expect(container.querySelector<HTMLInputElement>('input[aria-label="知识生成 API 地址"]')?.value)
      .toBe('https://api.deepseek.com');
    expect(container.querySelector<HTMLInputElement>('input[aria-label="知识生成模型名称"]')?.value)
      .toBe('deepseek-v4-flash');
  });

  it('applies ModelArk, preserves the API Key, and keeps the model editable', () => {
    const { container } = renderModal({ mode: 'default' });
    const provider = container.querySelector<HTMLSelectElement>('select[aria-label="API 平台"]')!;
    const key = container.querySelector<HTMLInputElement>('#knowledge-model-api-key')!;
    setInput(key, 'secret-key');

    setSelect(provider, 'modelark');

    expect(container.querySelector<HTMLInputElement>('input[aria-label="知识生成 API 地址"]')?.value)
      .toBe('https://ai.gitee.com/v1');
    const model = container.querySelector<HTMLInputElement>('input[aria-label="知识生成模型名称"]')!;
    expect(model.value).toBe('GLM-5');
    expect(key.value).toBe('secret-key');

    setInput(model, 'Qwen3.8-Plus');
    expect(model.value).toBe('Qwen3.8-Plus');
    expect(provider.value).toBe('modelark');

    const link = container.querySelector<HTMLAnchorElement>('[data-testid="model-api-key-link"]')!;
    expect(link.textContent).toContain('前往模力方舟（Gitee AI）获取 API Key');
    expect(link.href).toBe('https://ai.gitee.com/products/apis');
    expect(link.target).toBe('_blank');
    expect(link.rel).toContain('noopener');
    expect(link.rel).toContain('noreferrer');
  });

  it('switches to custom mode when the endpoint is manually overridden', () => {
    const { container } = renderModal({ mode: 'default' });
    const provider = container.querySelector<HTMLSelectElement>('select[aria-label="API 平台"]')!;
    const endpoint = container.querySelector<HTMLInputElement>('input[aria-label="知识生成 API 地址"]')!;

    setInput(endpoint, 'https://models.example.com/v1');

    expect(provider.value).toBe('custom');
    expect(container.querySelector('[data-testid="model-api-key-link"]')).toBeNull();
    expect(container.textContent).toContain('请前往服务商控制台获取 API Key');
  });

  it('recognizes a saved provider endpoint with a trailing slash', () => {
    act(() => useStore.setState({
      modelConfig: {
        endpoint: 'https://api.moonshot.cn/v1/',
        model: 'kimi-k2.6',
        apiKey: 'saved-key',
      },
    }));

    const { container } = renderModal({ mode: 'default' });

    expect(container.querySelector<HTMLSelectElement>('select[aria-label="API 平台"]')?.value).toBe('kimi');
    expect(container.querySelector<HTMLAnchorElement>('[data-testid="model-api-key-link"]')?.href)
      .toBe('https://platform.kimi.com/console/api-keys');
  });

  it('saves only the existing ModelConfig fields', () => {
    const { container } = renderModal({ mode: 'default' });
    const provider = container.querySelector<HTMLSelectElement>('select[aria-label="API 平台"]')!;
    setSelect(provider, 'modelark');
    setInput(container.querySelector<HTMLInputElement>('#knowledge-model-api-key')!, 'modelark-key');

    const save = Array.from(container.querySelectorAll('button'))
      .find(button => button.textContent === '保存配置')!;
    act(() => save.click());

    expect(useStore.getState().modelConfig).toEqual({
      endpoint: 'https://ai.gitee.com/v1',
      model: 'GLM-5',
      apiKey: 'modelark-key',
    });
  });
});
```

- [ ] **Step 3: Run the component test and confirm the expected failure**

Run:

```bash
pnpm test -- src/components/__tests__/SettingsModal.test.tsx
```

Expected: the existing MinerU tests pass and the new tests fail because the API platform selector and shortcut do not exist.

- [ ] **Step 4: Import provider definitions and update the default model**

Add this import to `src/components/SettingsModal.tsx`:

```typescript
import {
  CUSTOM_MODEL_PROVIDER_ID,
  MODEL_PROVIDER_PRESETS,
  findModelProviderByEndpoint,
  type ModelProviderSelection,
} from '../lib/model-providers';
```

Replace `DEFAULT_MODEL` with:

```typescript
const DEFAULT_PROVIDER = MODEL_PROVIDER_PRESETS[0];

const DEFAULT_MODEL: ModelConfig = {
  endpoint: DEFAULT_PROVIDER.endpoint,
  model: DEFAULT_PROVIDER.defaultModel,
  apiKey: '',
};
```

- [ ] **Step 5: Add provider UI state and preset handlers**

Add this state beside the existing `model` state:

```typescript
const [selectedProviderId, setSelectedProviderId] = useState<ModelProviderSelection>(DEFAULT_PROVIDER.id);
```

Inside the existing open-state effect, replace the single `setModel` call with:

```typescript
const nextModel = storedModel ?? DEFAULT_MODEL;
setModel(nextModel);
setSelectedProviderId(findModelProviderByEndpoint(nextModel.endpoint)?.id ?? CUSTOM_MODEL_PROVIDER_ID);
```

Add these derived values and handlers after `mineruValid`:

```typescript
const selectedProvider = MODEL_PROVIDER_PRESETS.find(provider => provider.id === selectedProviderId);

const selectProvider = (selection: ModelProviderSelection) => {
  setSelectedProviderId(selection);
  if (selection === CUSTOM_MODEL_PROVIDER_ID) return;
  const provider = MODEL_PROVIDER_PRESETS.find(candidate => candidate.id === selection);
  if (!provider) return;
  setModel(current => ({
    ...current,
    endpoint: provider.endpoint,
    model: provider.defaultModel,
  }));
};

const updateModelEndpoint = (endpoint: string) => {
  setModel(current => ({ ...current, endpoint }));
  setSelectedProviderId(findModelProviderByEndpoint(endpoint)?.id ?? CUSTOM_MODEL_PROVIDER_ID);
};
```

- [ ] **Step 6: Replace only the knowledge-generation form grid**

Replace the grid at `src/components/SettingsModal.tsx:144-156` with:

```tsx
<div className="grid gap-4 sm:grid-cols-2">
  <div className="sm:col-span-2">
    <Field label="API 平台">
      <select
        className="config-input"
        aria-label="API 平台"
        value={selectedProviderId}
        onChange={event => selectProvider(event.target.value as ModelProviderSelection)}
      >
        {MODEL_PROVIDER_PRESETS.map(provider => (
          <option key={provider.id} value={provider.id}>{provider.label}</option>
        ))}
        <option value={CUSTOM_MODEL_PROVIDER_ID}>自定义</option>
      </select>
    </Field>
    <p className="mt-2 text-xs leading-5 text-space-muted">
      {selectedProvider?.hint ?? '使用任意 OpenAI-compatible 服务，并手动填写地址与模型名称。'}
    </p>
  </div>

  <Field label="API 地址">
    <input
      className="config-input"
      aria-label="知识生成 API 地址"
      value={model.endpoint}
      onChange={event => updateModelEndpoint(event.target.value)}
      placeholder="https://api.example.com/v1"
    />
  </Field>
  <Field label="模型名称">
    <input
      className="config-input"
      aria-label="知识生成模型名称"
      value={model.model}
      onChange={event => setModel({ ...model, model: event.target.value })}
      placeholder="模型标识"
    />
  </Field>
  <div className="sm:col-span-2">
    <div className="mb-1.5 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
      <label htmlFor="knowledge-model-api-key" className="text-xs font-medium text-ink-light">API Key</label>
      {selectedProvider ? (
        <a
          href={selectedProvider.apiKeyUrl}
          target="_blank"
          rel="noopener noreferrer"
          data-testid="model-api-key-link"
          className="text-xs font-medium text-celadon-light underline decoration-celadon/40 underline-offset-4 hover:text-celadon"
        >
          前往{selectedProvider.label}获取 API Key ↗
        </a>
      ) : (
        <span className="text-xs text-space-muted">请前往服务商控制台获取 API Key</span>
      )}
    </div>
    <input
      id="knowledge-model-api-key"
      className="config-input"
      type="password"
      value={model.apiKey}
      onChange={event => setModel({ ...model, apiKey: event.target.value })}
      placeholder="sk-..."
      autoComplete="off"
    />
  </div>
</div>
```

- [ ] **Step 7: Keep clear-all state synchronized with the default provider**

Replace the clear button handler with:

```tsx
onClick={() => {
  setMinerUConfig(null);
  setModelConfig(null);
  setMineru(DEFAULT_MINERU);
  setModel(DEFAULT_MODEL);
  setSelectedProviderId(DEFAULT_PROVIDER.id);
}}
```

Leave its existing text and CSS classes unchanged.

- [ ] **Step 8: Run the focused component test and confirm it passes**

Run:

```bash
pnpm test -- src/components/__tests__/SettingsModal.test.tsx
```

Expected: PASS with the 3 existing MinerU tests and 5 new provider tests.

- [ ] **Step 9: Run type checking for the new union types and JSX**

Run:

```bash
pnpm run check
```

Expected: PASS with no TypeScript errors.

- [ ] **Step 10: Commit the settings UI**

```bash
git add src/components/SettingsModal.tsx src/components/__tests__/SettingsModal.test.tsx
git commit -m "feat: add API platform selector"
```

### Task 3: Regression and rendered-page verification

**Files:**
- Verify only; no planned source changes.

- [ ] **Step 1: Run the complete automated test suite**

Run:

```bash
pnpm test
```

Expected: all test files pass with no failures.

- [ ] **Step 2: Run lint and type checks**

Run:

```bash
pnpm run lint
pnpm run check
```

Expected: both commands exit with status 0 and no errors.

- [ ] **Step 3: Build the production bundle**

Run:

```bash
pnpm run build
```

Expected: TypeScript build and Vite production build both complete successfully and create `dist/`.

- [ ] **Step 4: Verify the rendered settings page in the local browser**

Use the existing local app at `http://127.0.0.1:4173/`, open “服务配置”, and inspect only “02 · 知识生成”. Confirm:

1. The provider selector is above API 地址 and 模型名称.
2. All 9 platforms and 自定义 are present.
3. 模力方舟（Gitee AI） fills `https://ai.gitee.com/v1` and `GLM-5`.
4. The official API Key shortcut updates when the provider changes.
5. API 地址 and 模型名称 stay editable.
6. API Key is retained while switching providers.
7. The layout remains two columns on desktop and has no clipping or horizontal overflow.
8. MinerU and the rest of the page are visually unchanged.

- [ ] **Step 5: Confirm the final diff is limited to the approved scope**

Run:

```bash
git status --short
git diff --stat HEAD~2..HEAD
git diff --check HEAD~2..HEAD
```

Expected: only the four implementation/test files from this plan appear in the two implementation commits, and `git diff --check` reports no whitespace errors.

- [ ] **Step 6: Record verification evidence in the task handoff**

Report the focused test counts, full test result, lint result, type-check result, build result, browser verification result, and the exact changed files. Do not claim platform credentials were validated because the feature only links to official consoles.
