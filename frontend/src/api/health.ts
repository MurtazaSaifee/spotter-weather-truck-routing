import { useQuery } from '@tanstack/react-query';
import { apiGet } from './client';

export interface HealthResponse {
  status: 'ok';
}

export function useHealth() {
  return useQuery({
    queryKey: ['health'],
    queryFn: ({ signal }) => apiGet<HealthResponse>('/api/health', { signal }),
  });
}
