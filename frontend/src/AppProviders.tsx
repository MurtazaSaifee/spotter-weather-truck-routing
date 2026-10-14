import { CssBaseline } from '@mui/material';
import { ThemeProvider } from '@mui/material/styles';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { theme } from './theme';

const appQueryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false },
  },
});

interface AppProvidersProps {
  children: ReactNode;
  /** Tests pass their own client; the app uses the shared default. */
  queryClient?: QueryClient;
}

export function AppProviders({ children, queryClient = appQueryClient }: AppProvidersProps) {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </ThemeProvider>
  );
}
