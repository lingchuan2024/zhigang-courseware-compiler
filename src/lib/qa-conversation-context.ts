import type {
  ChatCitationSnapshot,
  ChatHistoryTurn,
  LibraryCourse,
  LibraryDocument,
  RetrievalRecord,
} from '../types';
import type { KnowledgeCardSearchHit } from './card-retrieval';

function codePoints(value: string): string[] {
  return Array.from(value);
}

interface GraphemeSegmenter {
  segment(value: string): Iterable<{ segment: string }>;
}

type GraphemeSegmenterConstructor = new (
  locales?: string | string[],
  options?: { granularity: 'grapheme' },
) => GraphemeSegmenter;

function graphemes(value: string): string[] {
  const Segmenter = (Intl as typeof Intl & { Segmenter?: GraphemeSegmenterConstructor }).Segmenter;
  if (!Segmenter) return codePoints(value);
  return Array.from(new Segmenter(undefined, { granularity: 'grapheme' }).segment(value), item => item.segment);
}

export function createConversationTitle(question: string, maxLength = 24): string {
  const normalized = question.trim().replace(/\s+/g, ' ') || '新聊天';
  const limit = Math.max(0, Math.floor(maxLength));
  return graphemes(normalized).slice(0, limit).join('');
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
    const characters = graphemes(content);
    const remainingCharacters = maxCharacters - usedCharacters;
    if (characters.length > remainingCharacters) {
      if (selected.length === 0) {
        const retainedContent = remainingCharacters > 1
          ? characters.slice(-(remainingCharacters - 1)).join('')
          : '';
        selected.push({
          role: history[index].role,
          content: `…${retainedContent}`,
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
  hits: KnowledgeCardSearchHit[],
  courses: LibraryCourse[],
  documents: LibraryDocument[],
): ChatCitationSnapshot[] {
  const recordsByCardId = new Map<string, RetrievalRecord>();
  hits.forEach(hit => {
    if (!recordsByCardId.has(hit.record.cardId)) recordsByCardId.set(hit.record.cardId, hit.record);
  });
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
