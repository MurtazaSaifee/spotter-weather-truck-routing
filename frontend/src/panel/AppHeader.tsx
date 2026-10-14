import { Box, Typography } from '@mui/material';

export function AppHeader() {
  return (
    <Box component="header">
      <Typography component="h1" variant="h1">
        Weather-Aware Truck Routing
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
        Plan the safest truck route for the weather ahead
      </Typography>
    </Box>
  );
}
