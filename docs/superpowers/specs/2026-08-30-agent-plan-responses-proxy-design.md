# Agent Plan Responses Proxy Design

## Goal

Let 知纲 use a Volcengine Agent Plan subscription from both local development and a deployed static site. The first supported preset uses `glm-5-3-flash-260901` and the Agent Plan Responses API.

The implementation must solve both verified incompatibilities:

1. Agent Plan uses `https://ark.cn-beijing.volces.com/api/plan/v3/responses`, while the current client always calls `/chat/completions`.
2. The Agent Plan CORS preflight does not allow a browser `Authorization` header, so the browser cannot call the upstream directly.

## Non-goals

- Buying, renewing, rotating, or inspecting Agent Plan subscriptions inside 知纲.
- Replacing the existing OpenAI-compatible Chat Completions providers.
- Streaming model output.
- Hiding the API key from the operator's own reverse proxy. The existing browser configuration and local persistence behavior remain unchanged.
- Automatically editing an unknown production server's Nginx configuration.

## Chosen Architecture

### Explicit protocol selection

`ModelConfig` gains an optional `apiMode`:

```ts
type ModelApiMode = 'chat-completions' | 'responses';
```

Existing snapshots without this field default to `chat-completions`. Provider presets declare their mode explicitly; endpoint string matching is never used to infer a protocol.

The new preset is separate from ordinary “火山方舟”:

- label: `火山方舟 Agent Plan`
- endpoint: `/api/ark-agent-plan/v3`
- model: `glm-5-3-flash-260901`
- apiMode: `responses`

Keeping two presets prevents an Agent Plan model name from being sent to the pay-as-you-go Chat Completions lane or a platform Endpoint from being sent to the Plan lane.

### Same-origin proxy

The browser calls:

```text
POST /api/ark-agent-plan/v3/responses
```

The proxy forwards only that fixed path to:

```text
POST https://ark.cn-beijing.volces.com/api/plan/v3/responses
```

Allowed forwarded request headers are `authorization`, `content-type`, and `accept`. The proxy does not log the request body or credentials, does not accept an arbitrary target URL, and returns upstream status/body with a sanitized `502` on transport failure.

Local development and `vite preview` install the same middleware through a dedicated Vite plugin. Production gets an Nginx example location that forwards the same prefix, preserves the `Authorization` header, enables TLS SNI, and disables request-body logging guidance. `deploy.sh` continues to upload static assets; README explains that the Nginx location is a required deployment dependency, like the existing MinerU proxy.

## Responses Transport

The model client selects a transport from `apiMode`.

For `responses`, the request contains:

```json
{
  "model": "glm-5-3-flash-260901",
  "input": [{ "role": "system", "content": "..." }, { "role": "user", "content": "..." }],
  "max_output_tokens": 8192,
  "text": { "format": { "type": "json_object" } }
}
```

The client deliberately does not send `thinking.type=disabled`, because the verified GLM model rejects it. It extracts assistant text from Responses `output` message items and maps usage fields:

- `input_tokens` → `promptTokens`
- `output_tokens` → `completionTokens`
- `total_tokens` → `totalTokens`

`status=incomplete` with a max-output reason maps to the existing `response-truncated` error and structured retry. JSON fence cleanup and parsing remain shared with Chat Completions.

Configuration verification also selects the correct protocol. A successful HTTP response or `429` proves connectivity. `401/403`, `404`, timeout, and proxy `502` retain actionable user-facing messages.

## UI and Persistence

The service settings provider selector shows the Agent Plan preset and explains:

- use an Agent Plan API key, not a platform Endpoint key;
- the model ID is `glm-5-3-flash-260901`;
- requests use the local/deployed same-origin proxy.

`model-config-storage` accepts and persists `apiMode`. Missing mode remains backward compatible. Switching provider updates endpoint, model, and mode atomically.

No API key is committed, included in fixtures, printed in test output, or copied into deployment configuration.

## Error Handling

- Proxy cannot reach Volcengine: HTTP `502` with a generic message, no key/body echo.
- Upstream rejects authentication: preserve `401/403` so settings show an API-key error.
- Wrong model: preserve `404` and show the existing model/address guidance.
- Responses body has no output text: existing empty/truncated structured-response error.
- GLM consumes the output budget while reasoning: structured retry uses the existing retry path and larger production budget; the app never tries to disable mandatory thinking.

## Test Strategy

Tests are written before implementation:

1. Provider preset selects the proxy endpoint, full model ID, and `responses` mode.
2. Model configuration storage round-trips `apiMode` and defaults old configs safely.
3. Responses transport emits the expected request shape and parses output text/usage.
4. Incomplete Responses output triggers the existing structured retry behavior.
5. Agent Plan proxy maps only the fixed path, forwards only allowed headers, and sanitizes failures.
6. Settings verification uses `/responses`, not `/chat/completions`.
7. Existing Chat Completions provider tests continue to pass unchanged.
8. After automated verification, a local rendered smoke test runs the built-in probability-model course through the Agent Plan preset. Entering the user-provided key into the browser requires action-time confirmation immediately before typing it.

## Deployment Contract

The repository ships an Nginx example for the Agent Plan path and updates README deployment instructions. A deployment is considered Agent Plan-ready only when:

- the static application is served over HTTPS;
- `/api/ark-agent-plan/v3/responses` is reverse-proxied to the Beijing Agent Plan upstream;
- request size/timeouts accommodate course section compilation;
- access logs do not record authorization headers or request bodies.

This keeps the browser protocol stable across local development and production while leaving server ownership and TLS configuration explicit.
