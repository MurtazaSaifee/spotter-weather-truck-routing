import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { apiGet } from './client';

/** A chosen or suggested place. `time_zone` is the IANA zone at the coordinates. */
export interface Place {
  label: string;
  lat: number;
  lng: number;
  time_zone: string;
}

export interface PlaceSuggestions {
  /** Which service answered, so its attribution can be shown. */
  provider: 'here' | 'photon';
  suggestions: Place[];
}

/** The API rejects shorter queries, so none is sent. */
export const MIN_QUERY_LENGTH = 3;

const FIVE_MINUTES = 5 * 60 * 1000;

/** Suggestions for `query`. Idle until it is at least MIN_QUERY_LENGTH characters. */
export function usePlaceSuggestions(query: string) {
  return useQuery({
    queryKey: ['places', 'suggest', query],
    queryFn: ({ signal }) =>
      apiGet<PlaceSuggestions>(`/api/places/suggest?${new URLSearchParams({ q: query })}`, {
        signal,
      }),
    enabled: query.length >= MIN_QUERY_LENGTH,
    // Typing back over a query already asked is instant, and the list does not blink
    // empty between keystrokes.
    staleTime: FIVE_MINUTES,
    placeholderData: keepPreviousData,
    // The user is still typing; the next keystroke is the retry.
    retry: false,
  });
}
