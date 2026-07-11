import { describe, it, expect } from 'vitest';
import {
  normalizeAnchorName,
  findAnchorCandidates,
  rebuildAnchors,
} from '../global-anchors';
import { GlobalKnowledgeAnchor } from '../../types';
import { makeTopic, makeKnowledgePackage } from './helpers';

describe('global-anchors', () => {
  describe('normalizeAnchorName', () => {
    it('trims whitespace', () => {
      expect(normalizeAnchorName('  hello  ')).toBe('hello');
    });

    it('lowercases', () => {
      expect(normalizeAnchorName('MLE')).toBe('mle');
      expect(normalizeAnchorName('Maximum Likelihood Estimation')).toBe(
        'maximum likelihood estimation'
      );
    });

    it('collapses multiple whitespace into single space', () => {
      expect(normalizeAnchorName('hello    world')).toBe('hello world');
      expect(normalizeAnchorName('a   b\t\tc\n\nd')).toBe('a b c d');
    });

    it('handles empty string', () => {
      expect(normalizeAnchorName('')).toBe('');
    });
  });

  describe('findAnchorCandidates', () => {
    it('MLE / 最大似然估计 / Maximum Likelihood Estimation link to same anchor', () => {
      const anchor: GlobalKnowledgeAnchor = {
        id: 'anchor1',
        canonicalName: 'Maximum Likelihood Estimation',
        aliases: [],
        type: 'method',
        occurrenceIds: [],
      };

      // Topic with title 'MLE' should match via known alias group
      const topicMle = makeTopic({ id: 't1', title: 'MLE' });
      expect(findAnchorCandidates(topicMle, [anchor])).not.toBeNull();

      // Topic with title '最大似然估计' should also match
      const topicZh = makeTopic({ id: 't2', title: '最大似然估计' });
      expect(findAnchorCandidates(topicZh, [anchor])).not.toBeNull();

      // Topic with exact name 'Maximum Likelihood Estimation' should match
      const topicFull = makeTopic({ id: 't3', title: 'Maximum Likelihood Estimation' });
      expect(findAnchorCandidates(topicFull, [anchor])).not.toBeNull();
    });

    it('exact name match links to anchor', () => {
      const anchor: GlobalKnowledgeAnchor = {
        id: 'anchor1',
        canonicalName: 'Linear Regression',
        aliases: [],
        type: 'method',
        occurrenceIds: [],
      };
      const topic = makeTopic({ id: 't1', title: 'Linear Regression' });
      expect(findAnchorCandidates(topic, [anchor])).not.toBeNull();
    });

    it('alias match links to anchor', () => {
      const anchor: GlobalKnowledgeAnchor = {
        id: 'anchor1',
        canonicalName: 'Gradient Descent',
        aliases: ['GD', '梯度下降'],
        type: 'method',
        occurrenceIds: [],
      };
      const topic = makeTopic({ id: 't1', title: 'GD' });
      expect(findAnchorCandidates(topic, [anchor])).not.toBeNull();
    });

    it('no match returns null', () => {
      const anchor: GlobalKnowledgeAnchor = {
        id: 'anchor1',
        canonicalName: 'Linear Regression',
        aliases: [],
        type: 'method',
        occurrenceIds: [],
      };
      const topic = makeTopic({ id: 't1', title: 'Completely Different Topic' });
      expect(findAnchorCandidates(topic, [anchor])).toBeNull();
    });

    it('same name but different semantics (multiple matches) returns null (no auto-merge)', () => {
      // Two anchors with the same canonical name but different types
      // This is ambiguous -> should NOT auto-merge
      const anchor1: GlobalKnowledgeAnchor = {
        id: 'anchor1',
        canonicalName: 'Test',
        aliases: [],
        type: 'concept',
        occurrenceIds: [],
      };
      const anchor2: GlobalKnowledgeAnchor = {
        id: 'anchor2',
        canonicalName: 'Test',
        aliases: [],
        type: 'method',
        occurrenceIds: [],
      };
      const topic = makeTopic({ id: 't1', title: 'Test' });
      // Multiple matches -> ambiguous -> null
      expect(findAnchorCandidates(topic, [anchor1, anchor2])).toBeNull();
    });
  });

  describe('rebuildAnchors', () => {
    it('creates anchors from packages', () => {
      const topic1 = makeTopic({ id: 't1', title: 'Linear Regression' });
      const topic2 = makeTopic({ id: 't2', title: 'Logistic Regression' });
      const kp1 = makeKnowledgePackage({ id: 'kp1', topic: topic1 });
      const kp2 = makeKnowledgePackage({ id: 'kp2', topic: topic2 });

      const { anchors, occurrences } = rebuildAnchors([kp1, kp2], 'doc1');

      expect(anchors.length).toBe(2);
      expect(occurrences.length).toBe(2);
    });

    it('occurrences have documentId and knowledgePackageId', () => {
      const topic = makeTopic({ id: 't1', title: 'Test Topic' });
      const kp = makeKnowledgePackage({ id: 'kp1', topic });

      const { occurrences } = rebuildAnchors([kp], 'my-doc');

      expect(occurrences.length).toBe(1);
      expect(occurrences[0].documentId).toBe('my-doc');
      expect(occurrences[0].knowledgePackageId).toBe('kp1');
      expect(occurrences[0].globalAnchorId).toBeDefined();
      expect(occurrences[0].topicTitle).toBe('Test Topic');
    });

    it('auto-links packages with same alias group to one anchor', () => {
      const topic1 = makeTopic({ id: 't1', title: 'MLE' });
      const topic2 = makeTopic({ id: 't2', title: '最大似然估计' });
      const kp1 = makeKnowledgePackage({ id: 'kp1', topic: topic1 });
      const kp2 = makeKnowledgePackage({ id: 'kp2', topic: topic2 });

      const { anchors, occurrences } = rebuildAnchors([kp1, kp2], 'doc1');

      // Both should link to the same anchor
      expect(anchors.length).toBe(1);
      expect(anchors[0].occurrenceIds.length).toBe(2);
      expect(occurrences[0].globalAnchorId).toBe(occurrences[1].globalAnchorId);
    });

    it('anchor type matches topic type', () => {
      const topic = makeTopic({ id: 't1', title: 'SVM', type: 'method' });
      const kp = makeKnowledgePackage({ id: 'kp1', topic });

      const { anchors } = rebuildAnchors([kp], 'doc1');

      expect(anchors.length).toBe(1);
      expect(anchors[0].type).toBe('method');
    });

    it('handles empty packages array', () => {
      const { anchors, occurrences } = rebuildAnchors([], 'doc1');
      expect(anchors.length).toBe(0);
      expect(occurrences.length).toBe(0);
    });

    it('merges aliases from auto-linked topics', () => {
      const topic1 = makeTopic({ id: 't1', title: 'MLE', aliases: ['最大似然'] });
      const topic2 = makeTopic({ id: 't2', title: '最大似然估计', aliases: ['MLE估计'] });
      const kp1 = makeKnowledgePackage({ id: 'kp1', topic: topic1 });
      const kp2 = makeKnowledgePackage({ id: 'kp2', topic: topic2 });

      const { anchors } = rebuildAnchors([kp1, kp2], 'doc1');

      expect(anchors.length).toBe(1);
      // Aliases from both topics should be merged
      expect(anchors[0].aliases).toContain('最大似然');
      expect(anchors[0].aliases).toContain('MLE估计');
    });
  });
});
