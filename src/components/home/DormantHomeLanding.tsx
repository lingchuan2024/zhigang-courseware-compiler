import { AtlasLanding } from './AtlasLanding';
interface DormantHomeLandingProps {
  onOpenLibrary: () => void;
  onOpenQa: () => void;
  onOpenSettings: () => void;
}
export function DormantHomeLanding(props: DormantHomeLandingProps) {
  return <AtlasLanding {...props} />;
}
