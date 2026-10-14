import type { Place, PlaceSuggestions } from '../../api/places';

/** Typed against the API contract; the values are taken from the recorded HERE response. */
export const chicago: Place = {
  label: 'Chicago, IL, United States',
  lat: 41.88425,
  lng: -87.63245,
  time_zone: 'America/Chicago',
};

export const dallas: Place = {
  label: 'Dallas, TX, United States',
  lat: 32.77657,
  lng: -96.79699,
  time_zone: 'America/Chicago',
};

export const wrigleyField: Place = {
  label: 'Wrigley Field, 1060 W Addison St, Chicago, IL 60613, United States',
  lat: 41.94757,
  lng: -87.65631,
  time_zone: 'America/Chicago',
};

export const hereSuggestions: PlaceSuggestions = {
  provider: 'here',
  suggestions: [chicago, wrigleyField],
};

export const photonSuggestions: PlaceSuggestions = {
  provider: 'photon',
  suggestions: [
    {
      label: 'Chicago, Illinois, United States',
      lat: 41.8755616,
      lng: -87.6244212,
      time_zone: 'America/Chicago',
    },
  ],
};
