import { useLibraryStore } from '../store/useLibraryStore';
import { AtlasLanding } from './home/AtlasLanding';

export function HomeView({ onOpenSettings }: { onOpenSettings: () => void }) {
  const summaries = useLibraryStore(state => state.nebulaSummaries);
  const navigate = useLibraryStore(state => state.navigate);
  const openCourse = useLibraryStore(state => state.openCourse);
  return <AtlasLanding summaries={summaries} onOpenLibrary={() => navigate('library')}
    onOpenQa={() => navigate('qa')} onOpenSettings={onOpenSettings}
    onOpenCourse={id => void openCourse(id)} />;
}
