import { describe, expect, it } from 'vitest';
import type {
  ChatHistoryTurn,
  LibraryCourse,
  LibraryDocument,
  RetrievalRecord,
} from '../../types';
import {
  buildContextualRetrievalQuery,
  createCitationSnapshots,
  createConversationTitle,
  selectChatContext,
} from '../qa-conversation-context';

function turn(role: ChatHistoryTurn['role'], content: string): ChatHistoryTurn {
  return { role, content };
}

function record(cardId: string, courseId: string, documentId: string): RetrievalRecord {
  return {
    id: `record-${cardId}`,
    cardId,
    courseId,
    documentId,
    topicId: `topic-${cardId}`,
    teachingBlockId: `block-${cardId}`,
    title: `标题 ${cardId}`,
    content: `正文 ${cardId}`,
    keywords: [],
    aliases: [],
    sourceExcerpt: `原文 ${cardId}`,
    sourceRanges: [],
    version: 1,
  };
}

describe('QA conversation context', () => {
  it('builds retrieval query from the current question and only the last two user questions', () => {
    const history = [
      turn('user', '最早的问题'),
      turn('assistant', '不能进入检索查询的回答'),
      turn('user', '中间的问题'),
      turn('assistant', '另一个不能进入查询的回答'),
      turn('user', '最近的问题'),
    ];

    expect(buildContextualRetrievalQuery('  当前问题是什么？  ', history)).toBe([
      '当前问题是什么？',
      '上下文问题：中间的问题',
      '上下文问题：最近的问题',
    ].join('\n'));
    expect(buildContextualRetrievalQuery('当前问题是什么？', [])).toBe('当前问题是什么？');
  });

  it('keeps at most the newest 12 messages in chronological order without mutating input', () => {
    const history = Array.from({ length: 14 }, (_, index) => turn(
      index % 2 === 0 ? 'user' : 'assistant',
      `  消息 ${index + 1}  `,
    ));

    const selected = selectChatContext(history);

    expect(selected).toHaveLength(12);
    expect(selected.map(item => item.content)).toEqual(
      Array.from({ length: 12 }, (_, index) => `消息 ${index + 3}`),
    );
    expect(history[2].content).toBe('  消息 3  ');
    expect(selected[0]).not.toBe(history[2]);
  });

  it('preserves the newest suffix that fits the character budget', () => {
    const history = [
      turn('user', 'older'),
      turn('assistant', 'middle'),
      turn('user', 'newest'),
    ];

    expect(selectChatContext(history, { maxMessages: 12, maxCharacters: 12 })).toEqual([
      turn('assistant', 'middle'),
      turn('user', 'newest'),
    ]);
    expect(selectChatContext(history, { maxMessages: 0, maxCharacters: 12 })).toEqual([]);
    expect(selectChatContext(history, { maxMessages: 12, maxCharacters: 0 })).toEqual([]);
  });

  it('retains the rightmost characters of one oversized newest message', () => {
    const history = [turn('assistant', 'older'), turn('user', '  123456789  ')];

    expect(selectChatContext(history, { maxMessages: 12, maxCharacters: 4 })).toEqual([
      turn('user', '6789'),
    ]);
  });

  it('creates collapsed titles with a fallback and a 24-code-point bound', () => {
    expect(createConversationTitle('  GLM\n\t有哪些   组成？  ')).toBe('GLM 有哪些 组成？');
    expect(createConversationTitle(' \n\t ')).toBe('新聊天');

    const longTitle = `${'问'.repeat(23)}😀后续`;
    const title = createConversationTitle(longTitle);
    expect(Array.from(title)).toHaveLength(24);
    expect(title).toBe(`${'问'.repeat(23)}😀`);
  });

  it('creates ordered independent citation snapshots with deduplication and stable fallbacks', () => {
    const records = [
      record('card-1', 'course-1', 'doc-1'),
      record('card-2', 'course-missing', 'doc-missing'),
    ];
    const courses: LibraryCourse[] = [{
      id: 'course-1', name: '机器学习', documentIds: ['doc-1'], createdAt: 1, updatedAt: 1,
    }];
    const documents: LibraryDocument[] = [{
      id: 'doc-1', courseId: 'course-1', title: '第一讲', fileName: 'first.pdf', fileType: 'pdf',
      pageCount: 1, stage: 'cards', status: 'ready', uploadedAt: 1, updatedAt: 1,
    }];

    const snapshots = createCitationSnapshots(
      ['card-2', 'unknown-card', 'card-1', 'card-2'],
      records,
      courses,
      documents,
    );

    expect(snapshots).toEqual([
      {
        cardId: 'card-2', courseId: 'course-missing', documentId: 'doc-missing',
        courseName: '课程', documentTitle: '课件', title: '标题 card-2', content: '正文 card-2',
        sourceExcerpt: '原文 card-2',
      },
      {
        cardId: 'card-1', courseId: 'course-1', documentId: 'doc-1',
        courseName: '机器学习', documentTitle: '第一讲', title: '标题 card-1', content: '正文 card-1',
        sourceExcerpt: '原文 card-1',
      },
    ]);

    records[0].content = '已修改';
    courses[0].name = '已修改';
    documents[0].title = '已修改';
    expect(snapshots[1].content).toBe('正文 card-1');
    expect(snapshots[1].courseName).toBe('机器学习');
    expect(snapshots[1].documentTitle).toBe('第一讲');
  });
});
