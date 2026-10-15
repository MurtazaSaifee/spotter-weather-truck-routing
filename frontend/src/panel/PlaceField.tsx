import {
  Autocomplete,
  type AutocompleteProps,
  Paper,
  type PaperProps,
  TextField,
  Typography,
} from '@mui/material';
import { type ReactNode, useState } from 'react';
import { MIN_QUERY_LENGTH, type Place, usePlaceSuggestions } from '../api/places';
import { useDebouncedValue } from '../hooks/useDebouncedValue';

const SUGGESTION_DEBOUNCE_MS = 300;

const ATTRIBUTION = {
  here: 'Powered by HERE',
  photon: 'Search by Photon · © OpenStreetMap contributors',
} as const;

declare module '@mui/material/Autocomplete' {
  interface AutocompletePaperSlotPropsOverrides {
    /** Credit for the service that produced the listed suggestions. */
    attribution?: ReactNode;
  }
}

/** The suggestion list's surface, with the provider's credit underneath the options. */
function SuggestionsPaper({
  attribution,
  children,
  ...paperProps
}: PaperProps & { attribution?: ReactNode }) {
  return (
    <Paper {...paperProps}>
      {children}
      {attribution && (
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ display: 'block', px: 2, py: 0.75, borderTop: 1, borderColor: 'divider' }}
        >
          {attribution}
        </Typography>
      )}
    </Paper>
  );
}

const isSamePlace = (a: Place, b: Place) =>
  a.label === b.label && a.lat === b.lat && a.lng === b.lng;

interface PlaceFieldProps {
  label: string;
  /** The chosen place, or null while none is chosen. */
  value: Place | null;
  /** Called with the picked place, or with null when the field is cleared. */
  onChange: (place: Place | null) => void;
  /** Shown under the field, which turns red, while the place is not acceptable. */
  error?: string;
}

/**
 * A text field that suggests places as the driver types (after a pause, from three
 * characters) and reports the one they pick. Which places can come back is up to the backend.
 */
export function PlaceField({ label, value, onChange, error }: PlaceFieldProps) {
  const [inputValue, setInputValue] = useState('');
  const [open, setOpen] = useState(false);
  const query = inputValue.trim();
  const debouncedQuery = useDebouncedValue(query, SUGGESTION_DEBOUNCE_MS);

  // Picking a place fills the field with its label; that text is not a new search.
  const showsChosenPlace = value !== null && inputValue === value.label;
  const isSearching = query.length >= MIN_QUERY_LENGTH && !showsChosenPlace;
  const suggestionsQuery = usePlaceSuggestions(
    value && debouncedQuery === value.label ? '' : debouncedQuery,
  );

  const suggestions = isSearching ? (suggestionsQuery.data?.suggestions ?? []) : [];
  const listed = showsChosenPlace ? [value] : suggestions;
  // MUI needs the chosen place among its options to match it, even while the list shows
  // the suggestions for something the driver is typing over it.
  const options = value && !listed.some((p) => isSamePlace(p, value)) ? [value, ...listed] : listed;

  const isLoading = isSearching && (query !== debouncedQuery || suggestionsQuery.isFetching);
  const noOptionsText = suggestionsQuery.error?.message ?? 'No places found';
  // The list opens once there is something to show: suggestions, a search under way or its
  // outcome. Before that, nothing drops down.
  const hasContent = listed.length > 0 || query.length >= MIN_QUERY_LENGTH;

  const attribution =
    isSearching && suggestions.length > 0 && suggestionsQuery.data
      ? ATTRIBUTION[suggestionsQuery.data.provider]
      : undefined;

  const handleChange: AutocompleteProps<Place, false, false, false>['onChange'] = (_e, place) =>
    onChange(place);

  return (
    <Autocomplete
      options={options}
      open={open && hasContent}
      onOpen={() => setOpen(true)}
      onClose={() => setOpen(false)}
      // The server has already matched the text; filtering again would hide good suggestions.
      filterOptions={() => listed}
      value={value}
      onChange={handleChange}
      inputValue={inputValue}
      onInputChange={(_e, text) => setInputValue(text)}
      getOptionLabel={(place) => place.label}
      isOptionEqualToValue={isSamePlace}
      loading={isLoading}
      loadingText="Searching…"
      noOptionsText={noOptionsText}
      slots={{ paper: SuggestionsPaper }}
      slotProps={{ paper: { attribution } }}
      renderInput={(params) => (
        <TextField {...params} label={label} error={Boolean(error)} helperText={error} />
      )}
    />
  );
}
