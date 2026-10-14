import { AppShell } from './layout/AppShell';
import { MapView } from './map/MapView';
import { PlannerPanel } from './panel/PlannerPanel';

export default function App() {
  return <AppShell panel={<PlannerPanel />} map={<MapView />} />;
}
