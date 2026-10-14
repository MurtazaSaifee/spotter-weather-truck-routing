import { QueryClient } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import App from '../App';
import { AppProviders } from '../AppProviders';

/** Renders the whole app with a fresh, non-retrying query client. */
export function renderApp() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <AppProviders queryClient={queryClient}>
      <App />
    </AppProviders>,
  );
}
