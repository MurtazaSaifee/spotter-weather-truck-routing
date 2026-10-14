import { Box, CircularProgress } from '@mui/material';

/** Neutral stand-in that fills the map area while the map bundle loads. */
export function MapPlaceholder() {
  return (
    <Box
      sx={{
        width: '100%',
        height: '100%',
        display: 'grid',
        placeItems: 'center',
        bgcolor: 'grey.100',
      }}
    >
      <CircularProgress size={28} thickness={4} aria-label="Loading map" />
    </Box>
  );
}
