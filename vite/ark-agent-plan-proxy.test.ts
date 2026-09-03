import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Connect, PreviewServer } from 'vite';
import {
  arkAgentPlanProxyPlugin,
  resolveAgentPlanTarget,
  selectAgentPlanForwardHeaders,
} from './ark-agent-plan-proxy';

const EXPECTED_PROXY_TIMEOUT_MS = 180000;

class ResponseHarness extends EventEmitter {
  statusCode = 200;
  headers = new Map<string, string>();
  body = '';
  ended = false;

  setHeader(name: string, value: string): void {
    this.headers.set(name, value);
  }

  end(body?: string | Uint8Array): void {
    this.body = body === undefined ? '' : Buffer.from(body).toString();
    this.ended = true;
  }
}

type Middleware = (
  request: IncomingMessage,
  response: ServerResponse,
  next: Connect.NextFunction,
) => void;

function requestHarness(): IncomingMessage {
  const request = Readable.from([Buffer.from('{}')]) as IncomingMessage;
  request.method = 'POST';
  request.url = '/api/ark-agent-plan/v3/responses';
  request.headers = { 'content-type': 'application/json' };
  return request;
}

function installedMiddleware(): Middleware {
  let installed: Middleware | undefined;
  const server = {
    middlewares: {
      use: (handler: Middleware) => { installed = handler; },
    },
  } as unknown as PreviewServer;
  const hook = arkAgentPlanProxyPlugin().configurePreviewServer;
  if (typeof hook === 'function') hook(server);
  else hook?.handler(server);
  if (!installed) throw new Error('Agent Plan middleware was not installed');
  return installed;
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Agent Plan proxy', () => {
  it('maps only the same-origin Responses route to the Agent Plan data plane', () => {
    expect(resolveAgentPlanTarget('/api/ark-agent-plan/v3/responses?trace=1')?.toString())
      .toBe('https://ark.cn-beijing.volces.com/api/plan/v3/responses?trace=1');
    expect(resolveAgentPlanTarget('/api/ark-agent-plan/v3/chat/completions')).toBeNull();
    expect(resolveAgentPlanTarget('/api/mineru/v4/responses')).toBeNull();
  });

  it('forwards only the headers required by the upstream API', () => {
    const headers = selectAgentPlanForwardHeaders({
      authorization: 'Bearer local-token',
      'content-type': 'application/json',
      accept: 'application/json',
      cookie: 'private-cookie',
      origin: 'http://localhost:4173',
    });

    expect(headers.get('authorization')).toBe('Bearer local-token');
    expect(headers.get('content-type')).toBe('application/json');
    expect(headers.get('accept')).toBe('application/json');
    expect(headers.get('cookie')).toBeNull();
    expect(headers.get('origin')).toBeNull();
  });

  it('terminates an upstream request at the proxy deadline', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn((_target: unknown, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
    }));
    vi.stubGlobal('fetch', fetchMock);
    const response = new ResponseHarness();

    installedMiddleware()(requestHarness(), response as unknown as ServerResponse, vi.fn());
    await vi.advanceTimersByTimeAsync(EXPECTED_PROXY_TIMEOUT_MS + 1);
    await Promise.resolve();

    expect(response.statusCode).toBe(504);
    expect(response.body).toContain('agent-plan-proxy-timeout');
    expect(response.ended).toBe(true);
  });

  it('applies the proxy deadline while buffering a long response body', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn((_target: unknown, init?: RequestInit) => Promise.resolve({
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      arrayBuffer: () => new Promise<ArrayBuffer>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
      }),
    } as Response));
    vi.stubGlobal('fetch', fetchMock);
    const response = new ResponseHarness();

    installedMiddleware()(requestHarness(), response as unknown as ServerResponse, vi.fn());
    await vi.advanceTimersByTimeAsync(EXPECTED_PROXY_TIMEOUT_MS + 1);
    await Promise.resolve();

    expect(response.statusCode).toBe(504);
    expect(response.body).toContain('agent-plan-proxy-timeout');
  });

  it('aborts the upstream fetch when the browser cancels its request', async () => {
    let upstreamSignal: AbortSignal | null = null;
    const fetchMock = vi.fn((_target: unknown, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      upstreamSignal = init?.signal ?? null;
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
    }));
    vi.stubGlobal('fetch', fetchMock);
    const request = requestHarness();
    const response = new ResponseHarness();

    installedMiddleware()(request, response as unknown as ServerResponse, vi.fn());
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    request.emit('aborted');

    expect(upstreamSignal?.aborted).toBe(true);
  });
});
