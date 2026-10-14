import { useState } from 'react';
import type { Place } from './api/places';
import { AppShell } from './layout/AppShell';
import { MapView } from './map/MapView';
import { PlannerPanel } from './panel/PlannerPanel';

export default function App() {
  // The trip's two ends live here because the panel edits them and the map draws them.
  const [origin, setOrigin] = useState<Place | null>(null);
  const [destination, setDestination] = useState<Place | null>(null);

  return (
    <AppShell
      panel={
        <PlannerPanel
          origin={origin}
          onOriginChange={setOrigin}
          destination={destination}
          onDestinationChange={setDestination}
        />
      }
      map={<MapView origin={origin} destination={destination} />}
    />
  );
}
