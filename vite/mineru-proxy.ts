import { Buffer } from 'node:buffer';
import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from 'node:http';
import type { Connect, Plugin } from 'vite';

const API_PREFIX = '/api/mineru/v4';
const RESOURCE_PATH = '/api/mineru/resource';
const MINERU_API_ORIGIN = 'https://mineru.net';
type ForwardTarget = 'api' | 'resource';

function isAllowedResource(target: URL): boolean {
  if (target.protocol !== 'https:') return false;
  const host = target.hostname.toLowerCase();
  return host.endsWith('.openxlab.org.cn') ||
    (host.endsWith('.aliyuncs.com') && host.includes('mineru'));
}

async function readRequestBody(request: IncomingMessage): Promise<Buffer | undefined> {
  if (request.method === 'GET' || request.method === 'HEAD') return undefined;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return chunks.length > 0 ? Buffer.concat(chunks) : undefined;
}

export function selectForwardHeaders(headersFromBrowser: IncomingHttpHeaders, target: ForwardTarget): Headers {
  const headers = new Headers();
  const names = target === 'api'
    ? ['authorization', 'content-type', 'accept'] as const
    : ['accept'] as const;
  for (const name of names) {
    const value = headersFromBrowser[name];
    if (typeof value === 'string') headers.set(name, value);
  }
  return headers;
}

async function forward(
  request: IncomingMessage,
  response: ServerResponse,
  target: URL,
  targetType: ForwardTarget,
): Promise<void> {
  const body = await readRequestBody(request);
  const upstream = await fetch(target, {
    method: request.method,
    headers: selectForwardHeaders(request.headers, targetType),
    body,
    // Node fetch requires duplex for streamed/non-GET request bodies.
    duplex: body ? 'half' : undefined,
  } as RequestInit & { duplex?: 'half' });

  response.statusCode = upstream.status;
  const contentType = upstream.headers.get('content-type');
  if (contentType) response.setHeader('content-type', contentType);
  response.end(Buffer.from(await upstream.arrayBuffer()));
}

function middleware(request: IncomingMessage, response: ServerResponse, next: Connect.NextFunction): void {
  const requestUrl = new URL(request.url ?? '/', 'http://localhost');
  let target: URL | null = null;
  let targetType: ForwardTarget | null = null;

  if (requestUrl.pathname.startsWith(API_PREFIX)) {
    const upstreamPath = requestUrl.pathname.replace(API_PREFIX, '/api/v4');
    target = new URL(`${upstreamPath}${requestUrl.search}`, MINERU_API_ORIGIN);
    targetType = 'api';
  } else if (requestUrl.pathname === RESOURCE_PATH) {
    const rawTarget = requestUrl.searchParams.get('url');
    if (!rawTarget) {
      response.statusCode = 400;
      response.end('Missing MinerU resource URL');
      return;
    }
    try {
      const parsedTarget = new URL(rawTarget);
      if (!isAllowedResource(parsedTarget)) {
        response.statusCode = 403;
        response.end('MinerU resource host is not allowed');
        return;
      }
      target = parsedTarget;
      targetType = 'resource';
    } catch {
      response.statusCode = 400;
      response.end('Invalid MinerU resource URL');
      return;
    }
  }

  if (!target || !targetType) {
    next();
    return;
  }

  void forward(request, response, target, targetType).catch(error => {
    response.statusCode = 502;
    response.setHeader('content-type', 'application/json; charset=utf-8');
    response.end(JSON.stringify({
      code: -1,
      msg: error instanceof Error ? error.message : 'MinerU proxy request failed',
    }));
  });
}

export function mineruProxyPlugin(): Plugin {
  return {
    name: 'zhigang-mineru-proxy',
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
  };
}
