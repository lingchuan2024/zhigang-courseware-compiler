import { create } from 'zustand';
import type { CourseNebulaSummary, LibraryCourse, LibraryDocument } from '../types';
import {
  createLibraryCourse,
  deleteLibraryCourseCascade,
  deleteLibraryDocumentCascade,
  listLibraryCourses,
  listLibraryDocuments,
  listCourseNebulaSummaries,
  loadLibraryProjectSnapshot,
  migrateLegacyProjectToLibrary,
} from '../lib/library-repository';
import { useStore } from './useStore';
import { loadState, pickPersistedFields } from '../lib/persistence';

export type LibraryScreen = 'home' | 'library' | 'workspace' | 'qa';

interface LibraryState {
  screen: LibraryScreen;
  courses: LibraryCourse[];
  documents: LibraryDocument[];
  nebulaSummaries: CourseNebulaSummary[];
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
  deleteDocument: (documentId: string) => Promise<void>;
  deleteCourse: (courseId: string) => Promise<void>;
}

async function loadLibraryData(): Promise<{
  courses: LibraryCourse[];
  documents: LibraryDocument[];
  nebulaSummaries: CourseNebulaSummary[];
}> {
  const [courses, documents, nebulaSummaries] = await Promise.all([
    listLibraryCourses(),
    listLibraryDocuments(),
    listCourseNebulaSummaries(),
  ]);
  return { courses, documents, nebulaSummaries };
}

export const useLibraryStore = create<LibraryState>((set, get) => ({
  screen: 'home',
  courses: [],
  documents: [],
  nebulaSummaries: [],
  activeCourseId: null,
  initialized: false,
  loading: false,
  error: null,

  initialize: async () => {
    set({ loading: true, error: null, screen: 'home' });
    try {
      await migrateLegacyProjectToLibrary(loadState());
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
        ...pickPersistedFields(snapshot as Record<string, unknown>),
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

  deleteDocument: async documentId => {
    set({ loading: true, error: null });
    try {
      await deleteLibraryDocumentCascade(documentId);
      if (useStore.getState().document?.id === documentId) {
        useStore.setState({ stage: 'upload', document: null, job: null, jobStatus: 'idle' });
      }
      const data = await loadLibraryData();
      const activeCourseId = data.courses.some(course => course.id === get().activeCourseId)
        ? get().activeCourseId
        : data.courses[0]?.id ?? null;
      set({ ...data, activeCourseId, loading: false });
    } catch (error) {
      set({ loading: false, error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  },

  deleteCourse: async courseId => {
    set({ loading: true, error: null });
    try {
      const deletedDocumentIds = new Set(get().documents.filter(document => document.courseId === courseId).map(document => document.id));
      await deleteLibraryCourseCascade(courseId);
      if (useStore.getState().document && deletedDocumentIds.has(useStore.getState().document!.id)) {
        useStore.setState({ stage: 'upload', document: null, job: null, jobStatus: 'idle' });
      }
      const data = await loadLibraryData();
      const previousActive = get().activeCourseId;
      const activeCourseId = previousActive !== courseId && data.courses.some(course => course.id === previousActive)
        ? previousActive
        : data.courses[0]?.id ?? null;
      set({ ...data, activeCourseId, loading: false });
    } catch (error) {
      set({ loading: false, error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  },
}));
