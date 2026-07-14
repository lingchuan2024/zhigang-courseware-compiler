import type {
  ChatCitationSnapshot,
  ChatHistoryTurn,
  LibraryCourse,
  LibraryDocument,
  RetrievalRecord,
} from '../types';

function codePoints(value: string): string[] {
  return Array.from(value);
}

export function createConversationTitle(question: string, maxLength = 24): string {
  const normalized = question.trim().replace(/\s+/g, ' ') || '新聊天';
  const limit = Math.max(0, Math.floor(maxLength));
  return codePoints(normalized).slice(0, limit).join('');
}

export function buildContextualRetrievalQuery(
  question: string,
  history: ChatHistoryTurn[],
  maxUserTurns = 2,
): string {
  const currentQuestion = question.trim();
  const limit = Math.max(0, Math.floor(maxUserTurns));
  const userTurns = history
    .filter(turn => turn.role === 'user')
    .map(turn => `上下文问题：${turn.content.trim()}`);
  const recentUserTurns = limit > 0 ? userTurns.slice(-limit) : [];
  return [currentQuestion, ...recentUserTurns].join('\n');
}

export function selectChatContext(
  history: ChatHistoryTurn[],
  limits: { maxMessages?: number; maxCharacters?: number } = {},
): ChatHistoryTurn[] {
  const maxMessages = Math.floor(limits.maxMessages ?? 12);
  const maxCharacters = Math.floor(limits.maxCharacters ?? 16000);
  if (maxMessages <= 0 || maxCharacters <= 0) return [];

  const selected: ChatHistoryTurn[] = [];
  let usedCharacters = 0;
  for (let index = history.length - 1; index >= 0 && selected.length < maxMessages; index -= 1) {
    const content = history[index].content.trim();
    const characters = codePoints(content);
    const remainingCharacters = maxCharacters - usedCharacters;
    if (characters.length > remainingCharacters) {
      if (selected.length === 0) {
        selected.push({
          role: history[index].role,
          content: characters.slice(-remainingCharacters).join(''),
        });
      }
      break;
    }
    selected.push({ role: history[index].role, content });
    usedCharacters += characters.length;
  }

  return selected.reverse();
}

export function createCitationSnapshots(
  cardIds: string[],
  records: RetrievalRecord[],
  courses: LibraryCourse[],
  documents: LibraryDocument[],
): ChatCitationSnapshot[] {
  const recordsByCardId = new Map(records.map(record => [record.cardId, record]));
  const coursesById = new Map(courses.map(course => [course.id, course]));
  const documentsById = new Map(documents.map(document => [document.id, document]));
  const seen = new Set<string>();

  return cardIds.flatMap(cardId => {
    if (seen.has(cardId)) return [];
    seen.add(cardId);
    const record = recordsByCardId.get(cardId);
    if (!record) return [];
    const courseName = coursesById.get(record.courseId)?.name.trim() || '课程';
    const documentTitle = documentsById.get(record.documentId)?.title.trim() || '课件';
    return [{
      cardId: record.cardId,
      courseId: record.courseId,
      documentId: record.documentId,
      courseName,
      documentTitle,
      title: record.title,
      content: record.content,
      sourceExcerpt: record.sourceExcerpt,
    }];
  });
}
