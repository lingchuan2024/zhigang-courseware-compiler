import { describe, expect, it } from 'vitest';
import { resolveAgentPlanTarget, selectAgentPlanForwardHeaders } from './ark-agent-plan-proxy';

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
});
