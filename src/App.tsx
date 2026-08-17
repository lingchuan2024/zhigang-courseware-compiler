import { useEffect, useState } from 'react';
import { useStore } from './store/useStore';
import { Sidebar } from './components/Sidebar';
import { UploadView } from './components/UploadView';
import { DocumentReviewWorkspace } from './components/document-review/DocumentReviewWorkspace';
import { KnowledgeStructureView } from './components/KnowledgeStructureView';
import { MasterNoteView } from './components/MasterNoteView';
import { SettingsModal } from './components/SettingsModal';
import { MinerUParseView } from './components/MinerUParseView';
import { KnowledgeCardsView } from './components/KnowledgeCardsView';
import { HomeView } from './components/HomeView';
import { LibraryView } from './components/LibraryView';
import { AppShell } from './components/AppShell';
import { useLibraryStore } from './store/useLibraryStore';
import { KnowledgeQaView } from './components/KnowledgeQaView';
import { AstronomyBackdrop } from './components/backgrounds/AstronomyBackdrop';

function App() {
  const stage = useStore(s => s.stage);
  const startMinerUParse = useStore(s => s.startMinerUParse);
  const courseDocument = useStore(s => s.document);
  const mineruConfig = useStore(s => s.mineruConfig);
  const initializeFromStorage = useStore(s => s.initializeFromStorage);
  const screen = useLibraryStore(s => s.screen);
  const initializeLibrary = useLibraryStore(s => s.initialize);
  const libraryInitialized = useLibraryStore(s => s.initialized);
  const navigateLibrary = useLibraryStore(s => s.navigate);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsIntent, setSettingsIntent] = useState<'default' | 'resume-mineru'>('default');
  const [initialized, setInitialized] = useState(false);

  const closeSettings = () => {
    setSettingsOpen(false);
    setSettingsIntent('default');
  };

  const openDefaultSettings = () => {
    setSettingsIntent('default');
    setSettingsOpen(true);
  };

  const requestMinerUParse = async () => {
    if (courseDocument?.fileType === 'markdown' || mineruConfig?.apiKey) {
      await startMinerUParse();
      return;
    }
    setSettingsIntent('resume-mineru');
    setSettingsOpen(true);
  };

  const handleSettingsSaved = ({ mineruConfigured }: { mineruConfigured: boolean }) => {
    if (settingsIntent !== 'resume-mineru' || !mineruConfigured) return;
    setSettingsIntent('default');
    void useStore.getState().startMinerUParse();
  };

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
        <HomeView onOpenSettings={openDefaultSettings} />
        <SettingsModal isOpen={settingsOpen} mode={settingsIntent} onSaved={handleSettingsSaved} onClose={closeSettings} />
      </>
    );
  }

  if (screen === 'library') return <LibraryView />;

  if (screen === 'qa') {
    return (
      <>
        <AppShell backdrop="qa" onHome={() => navigateLibrary('home')} action={<button type="button" onClick={() => navigateLibrary('library')} className="text-sm text-ink/70">课件库</button>}>
          <KnowledgeQaView onOpenSettings={openDefaultSettings} />
        </AppShell>
        <SettingsModal isOpen={settingsOpen} mode={settingsIntent} onSaved={handleSettingsSaved} onClose={closeSettings} />
      </>
    );
  }

  const renderStage = () => {
    switch (stage) {
      case 'upload':
        return <UploadView />;
      case 'document':
        return <DocumentReviewWorkspace onRequestMinerUParse={requestMinerUParse} />;
      case 'mineru':
        return <MinerUParseView onOpenSettings={openDefaultSettings} />;
      case 'structure':
        return <KnowledgeStructureView onOpenSettings={openDefaultSettings} />;
      case 'cards':
        return <KnowledgeCardsView />;
      case 'notes':
        return <MasterNoteView onOpenSettings={openDefaultSettings} />;
      default:
        return <UploadView />;
    }
  };

  return (
    <div className="relative h-screen overflow-hidden bg-space-950">
      <AstronomyBackdrop variant={stage === 'notes' ? 'reading' : 'workspace'} />
      <div className="relative z-10 flex h-full overflow-hidden">
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

        <Sidebar onOpenSettings={openDefaultSettings} />

        <main className="flex-1 flex flex-col overflow-hidden">
          {renderStage()}
        </main>

        <SettingsModal isOpen={settingsOpen} mode={settingsIntent} onSaved={handleSettingsSaved} onClose={closeSettings} />
      </div>
    </div>
  );
}

export default App;
