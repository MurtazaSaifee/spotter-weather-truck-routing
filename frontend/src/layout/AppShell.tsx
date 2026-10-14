import { Box } from '@mui/material';
import type { ReactNode } from 'react';

const PANEL_WIDTH = 400;

interface AppShellProps {
  /** Content of the left-hand planner panel. */
  panel: ReactNode;
  /** Content of the map area, which fills the remaining space. */
  map: ReactNode;
}

/**
 * Desktop layout: a fixed-width panel beside a full-bleed map. It only places
 * the two regions, so a phone layout (map with a bottom sheet) can be added
 * as a sibling shell without touching panel or map content.
 */
export function AppShell({ panel, map }: AppShellProps) {
  return (
    <Box sx={{ display: 'flex', height: '100dvh', overflow: 'hidden' }}>
      <Box
        component="aside"
        sx={{
          flex: `0 0 ${PANEL_WIDTH}px`,
          overflowY: 'auto',
          bgcolor: 'background.paper',
          borderRight: 1,
          borderColor: 'divider',
        }}
      >
        {panel}
      </Box>
      <Box component="main" sx={{ flex: 1, minWidth: 0 }}>
        {map}
      </Box>
    </Box>
  );
}
