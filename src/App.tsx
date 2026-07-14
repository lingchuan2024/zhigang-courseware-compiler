import { useEffect, useState } from 'react';
import { useStore } from './store/useStore';
import { Sidebar } from './components/Sidebar';
import { UploadView } from './components/UploadView';
import { DocumentReviewWorkspace } from './components/document-review/DocumentReviewWorkspace';
import { KnowledgeStructureView } from './components/KnowledgeStructureView';
import { NotesView } from './components/NotesView';
import { SettingsModal } from './components/SettingsModal';
import { MinerUParseView } from './components/MinerUParseView';
import { KnowledgeCardsView } from './components/KnowledgeCardsView';
import { HomeView } from './components/HomeView';
import { LibraryView } from './components/LibraryView';
import { AppShell } from './components/AppShell';
import { useLibraryStore } from './store/useLibraryStore';

function App() {
  const stage = useStore(s => s.stage);
  const initializeFromStorage = useStore(s => s.initializeFromStorage);
  const screen = useLibraryStore(s => s.screen);
  const initializeLibrary = useLibraryStore(s => s.initialize);
  const libraryInitialized = useLibraryStore(s => s.initialized);
  const navigateLibrary = useLibraryStore(s => s.navigate);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    initializeFromStorage();
    void initializeLibrary().finally(() => setInitialized(true));
  }, [initializeFromStorage, initializeLibrary]);

  if (!initialized || !libraryInitialized) {
    return (
      <div className="min-h-screen bg-paper flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-paper-dark border-t-celadon rounded-full animate-spin"></div>
      </div>
    );
  }

  if (screen === 'home') {
    return (
      <>
        <HomeView onOpenSettings={() => setSettingsOpen(true)} />
        <SettingsModal isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} />
      </>
    );
  }

  if (screen === 'library') return <LibraryView />;

  if (screen === 'qa') {
    return (
      <AppShell onHome={() => navigateLibrary('home')} action={<button type="button" onClick={() => navigateLibrary('library')} className="text-sm text-ink/70">课件库</button>}>
        <div className="grid min-h-[calc(100vh-4rem)] place-items-center px-6 text-center">
          <div><p className="font-song text-3xl font-bold text-ink">全库知识问答</p><p className="mt-3 text-stone-500">正在建立知识卡片索引。</p></div>
        </div>
      </AppShell>
    );
  }

  const renderStage = () => {
    switch (stage) {
      case 'upload':
        return <UploadView />;
      case 'document':
        return <DocumentReviewWorkspace />;
      case 'mineru':
        return <MinerUParseView onOpenSettings={() => setSettingsOpen(true)} />;
      case 'structure':
        return <KnowledgeStructureView onOpenSettings={() => setSettingsOpen(true)} />;
      case 'cards':
        return <KnowledgeCardsView />;
      case 'notes':
        return <NotesView onOpenSettings={() => setSettingsOpen(true)} />;
      default:
        return <UploadView />;
    }
  };

  return (
    <div className="flex h-screen overflow-hidden bg-paper">
      {/* 移动端菜单按钮 */}
      <div className="md:hidden fixed top-4 left-4 z-40">
        <button
          onClick={() => {
            // 简单处理：在移动端可以展开/收起侧栏
            const sidebar = document.querySelector('aside');
            if (sidebar) {
              sidebar.classList.toggle('-translate-x-full');
            }
          }}
          className="bg-ink text-white p-2 rounded shadow-lg"
          aria-label="打开菜单"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
      </div>

      <Sidebar onOpenSettings={() => setSettingsOpen(true)} />

      <main className="flex-1 flex flex-col overflow-hidden">
        {renderStage()}
      </main>

      <SettingsModal isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}

export default App;
