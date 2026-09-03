import { Buffer } from 'node:buffer';
import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from 'node:http';
import type { Connect, Plugin } from 'vite';

const LOCAL_RESPONSES_PATH = '/api/ark-agent-plan/v3/responses';
const AGENT_PLAN_ORIGIN = 'https://ark.cn-beijing.volces.com';
const UPSTREAM_RESPONSES_PATH = '/api/plan/v3/responses';
export const AGENT_PLAN_PROXY_TIMEOUT_MS = 180000;

class AgentPlanProxyTimeoutError extends Error {}
class AgentPlanClientDisconnectedError extends Error {}

async function readRequestBody(request: IncomingMessage): Promise<Buffer | undefined> {
  if (request.method === 'GET' || request.method === 'HEAD') return undefined;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return chunks.length > 0 ? Buffer.concat(chunks) : undefined;
}

export function resolveAgentPlanTarget(requestUrl: string): URL | null {
  const parsed = new URL(requestUrl, 'http://localhost');
  if (parsed.pathname !== LOCAL_RESPONSES_PATH) return null;
  return new URL(`${UPSTREAM_RESPONSES_PATH}${parsed.search}`, AGENT_PLAN_ORIGIN);
}

export function selectAgentPlanForwardHeaders(headersFromBrowser: IncomingHttpHeaders): Headers {
  const headers = new Headers();
  for (const name of ['authorization', 'content-type', 'accept'] as const) {
    const value = headersFromBrowser[name];
    if (typeof value === 'string') headers.set(name, value);
  }
  return headers;
}

async function forward(request: IncomingMessage, response: ServerResponse, target: URL): Promise<void> {
  const controller = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let onClientDisconnect: (() => void) | undefined;
  let timedOut = false;
  let clientWasDisconnected = false;
  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutId = setTimeout(() => {
      timedOut = true;
      controller.abort(new DOMException('Agent Plan proxy request timed out', 'TimeoutError'));
      reject(new AgentPlanProxyTimeoutError());
    }, AGENT_PLAN_PROXY_TIMEOUT_MS);
  });
  const clientDisconnected = new Promise<never>((_resolve, reject) => {
    onClientDisconnect = () => {
      clientWasDisconnected = true;
      controller.abort(new DOMException('Browser request was cancelled', 'AbortError'));
      reject(new AgentPlanClientDisconnectedError());
    };
    request.once('aborted', onClientDisconnect);
    response.once('close', onClientDisconnect);
  });

  try {
    const operation = (async () => {
      const body = await readRequestBody(request);
      const upstream = await fetch(target, {
        method: request.method,
        headers: selectAgentPlanForwardHeaders(request.headers),
        body,
        duplex: body ? 'half' : undefined,
        signal: controller.signal,
      } as RequestInit & { duplex?: 'half' });
      return { upstream, payload: Buffer.from(await upstream.arrayBuffer()) };
    })();
    const { upstream, payload } = await Promise.race([operation, timeout, clientDisconnected]);

    response.statusCode = upstream.status;
    for (const name of ['content-type', 'x-request-id'] as const) {
      const value = upstream.headers.get(name);
      if (value) response.setHeader(name, value);
    }
    response.end(payload);
  } catch (error) {
    if (clientWasDisconnected || error instanceof AgentPlanClientDisconnectedError) return;
    if (timedOut || error instanceof AgentPlanProxyTimeoutError) {
      if (!response.writableEnded && !response.destroyed) {
        response.statusCode = 504;
        response.setHeader('content-type', 'application/json; charset=utf-8');
        response.end(JSON.stringify({
          code: 'agent-plan-proxy-timeout',
          message: 'Agent Plan proxy request timed out',
        }));
      }
      return;
    }
    throw error;
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
    if (onClientDisconnect) {
      request.removeListener('aborted', onClientDisconnect);
      response.removeListener('close', onClientDisconnect);
    }
  }
}

function middleware(request: IncomingMessage, response: ServerResponse, next: Connect.NextFunction): void {
  const target = resolveAgentPlanTarget(request.url ?? '/');
  if (!target) {
    next();
    return;
  }

  void forward(request, response, target).catch(() => {
    response.statusCode = 502;
    response.setHeader('content-type', 'application/json; charset=utf-8');
    response.end(JSON.stringify({
      code: 'agent-plan-proxy-failed',
      message: 'Agent Plan proxy request failed',
    }));
  });
}

export function arkAgentPlanProxyPlugin(): Plugin {
  return {
    name: 'zhigang-ark-agent-plan-proxy',
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
  };
}
