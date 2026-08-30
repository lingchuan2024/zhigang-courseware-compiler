import { describe, expect, it } from 'vitest';
import type { TeachingUnit } from '../types';
import { compileTeachingPath } from '../teaching-path-compiler';

const unit = (id: string, role: TeachingUnit['role']): TeachingUnit => ({
  id,
  stableKey: id,
  topicId: 't1',
  role,
  title: id,
  summary: id,
  evidenceIds: [`e-${id}`],
  required: true,
  confidence: 0.9,
  status: 'verified',
});

describe('teaching path compiler', () => {
  it('uses the concept template without creating missing roles', () => {
    expect(compileTeachingPath(
      'concept',
      [unit('example', 'example'), unit('definition', 'definition'), unit('intuition', 'intuition')],
      new Map(),
    )).toEqual(['intuition', 'definition', 'example']);
  });

  it('uses source order before stable keys inside the same role', () => {
    const sourceOrder = new Map([['e-step-b', 1], ['e-step-a', 2]]);
    expect(compileTeachingPath(
      'derivation',
      [unit('step-a', 'derivation_step'), unit('step-b', 'derivation_step')],
      sourceOrder,
    )).toEqual(['step-b', 'step-a']);
  });
});
