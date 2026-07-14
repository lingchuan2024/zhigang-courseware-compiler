import { create } from 'zustand';
import type { LibraryCourse, LibraryDocument } from '../types';
import {
  createLibraryCourse,
  listLibraryCourses,
  listLibraryDocuments,
  loadLibraryProjectSnapshot,
} from '../lib/library-repository';
import { useStore } from './useStore';

export type LibraryScreen = 'home' | 'library' | 'workspace' | 'qa';

interface LibraryState {
  screen: LibraryScreen;
  courses: LibraryCourse[];
  documents: LibraryDocument[];
  activeCourseId: string | null;
  initialized: boolean;
  loading: boolean;
  error: string | null;
  initialize: () => Promise<void>;
  refresh: () => Promise<void>;
  navigate: (screen: LibraryScreen) => void;
  createCourse: (name: string) => Promise<LibraryCourse>;
  openCourse: (courseId: string) => Promise<void>;
  startNewDocument: (courseId?: string) => void;
  openDocument: (documentId: string) => Promise<void>;
}

async function loadLibraryData(): Promise<{ courses: LibraryCourse[]; documents: LibraryDocument[] }> {
  const [courses, documents] = await Promise.all([listLibraryCourses(), listLibraryDocuments()]);
  return { courses, documents };
}

export const useLibraryStore = create<LibraryState>((set, get) => ({
  screen: 'home',
  courses: [],
  documents: [],
  activeCourseId: null,
  initialized: false,
  loading: false,
  error: null,

  initialize: async () => {
    set({ loading: true, error: null, screen: 'home' });
    try {
      const data = await loadLibraryData();
      const activeCourseId = data.courses.some(course => course.id === get().activeCourseId)
        ? get().activeCourseId
        : data.courses[0]?.id ?? null;
      set({ ...data, activeCourseId, initialized: true, loading: false });
    } catch (error) {
      set({ initialized: true, loading: false, error: error instanceof Error ? error.message : String(error) });
    }
  },

  refresh: async () => {
    try {
      const data = await loadLibraryData();
      set({ ...data, error: null });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) });
    }
  },

  navigate: screen => {
    set({ screen });
    if (screen === 'library' || screen === 'home') void get().refresh();
  },

  createCourse: async name => {
    const course = await createLibraryCourse({ name });
    await get().refresh();
    set({ activeCourseId: course.id, screen: 'library' });
    return course;
  },

  openCourse: async courseId => {
    set({ activeCourseId: courseId, screen: 'library' });
    await get().refresh();
  },

  startNewDocument: courseId => {
    const targetCourseId = courseId ?? get().activeCourseId;
    if (!targetCourseId) return;
    useStore.setState({ stage: 'upload', document: null, job: null, jobStatus: 'idle' });
    set({ activeCourseId: targetCourseId, screen: 'workspace' });
  },

  openDocument: async documentId => {
    set({ loading: true, error: null });
    try {
      const snapshot = await loadLibraryProjectSnapshot(documentId);
      if (!snapshot) throw new Error('课件快照不存在，请重新导入课件');
      const current = useStore.getState();
      useStore.setState({
        ...snapshot,
        modelConfig: current.modelConfig,
        mineruConfig: current.mineruConfig,
      });
      const document = get().documents.find(item => item.id === documentId);
      set({
        activeCourseId: document?.courseId ?? snapshot.document?.courseId ?? get().activeCourseId,
        screen: 'workspace',
        loading: false,
      });
    } catch (error) {
      set({ loading: false, error: error instanceof Error ? error.message : String(error) });
    }
  },
}));
