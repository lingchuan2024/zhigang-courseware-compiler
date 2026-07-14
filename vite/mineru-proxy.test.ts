import { describe, expect, it } from 'vitest';
import { selectForwardHeaders } from './mineru-proxy';

describe('MinerU proxy request headers', () => {
  it('does not forward browser-generated headers to a signed resource URL', () => {
    const headers = selectForwardHeaders({
      authorization: 'Bearer local-token',
      'content-type': 'application/pdf',
      accept: '*/*',
    }, 'resource');

    expect(headers.get('authorization')).toBeNull();
    expect(headers.get('content-type')).toBeNull();
    expect(headers.get('accept')).toBe('*/*');
  });

  it('keeps authorization and content type for MinerU API calls', () => {
    const headers = selectForwardHeaders({
      authorization: 'Bearer local-token',
      'content-type': 'application/json',
      accept: 'application/json',
    }, 'api');

    expect(headers.get('authorization')).toBe('Bearer local-token');
    expect(headers.get('content-type')).toBe('application/json');
    expect(headers.get('accept')).toBe('application/json');
  });
});
