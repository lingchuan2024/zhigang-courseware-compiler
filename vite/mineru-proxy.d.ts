import type { IncomingHttpHeaders } from 'node:http';
import type { Plugin } from 'vite';
type ForwardTarget = 'api' | 'resource';
export declare function selectForwardHeaders(headersFromBrowser: IncomingHttpHeaders, target: ForwardTarget): Headers;
export declare function mineruProxyPlugin(): Plugin;
export {};
