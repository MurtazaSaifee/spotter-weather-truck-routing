import { useTheme } from '@mui/material/styles';
import { Marker } from 'react-map-gl/maplibre';
import type { Place } from '../api/places';

interface PinProps {
  kind: 'Origin' | 'Destination';
  /** The letter drawn on the pin. */
  mark: string;
  color: string;
  place: Place;
}

function Pin({ kind, mark, color, place }: PinProps) {
  return (
    <Marker longitude={place.lng} latitude={place.lat} anchor="bottom">
      <svg
        role="img"
        aria-label={`${kind} pin: ${place.label}`}
        width="32"
        height="42"
        viewBox="0 0 32 42"
      >
        <title>{`${kind}: ${place.label}`}</title>
        <path
          d="M16 1C8 1 1.5 7.4 1.5 15.2 1.5 25.5 16 41 16 41S30.5 25.5 30.5 15.2C30.5 7.4 24 1 16 1Z"
          fill={color}
          stroke="#fff"
          strokeWidth="2"
        />
        <text
          x="16"
          y="20.5"
          textAnchor="middle"
          fontSize="14"
          fontWeight="700"
          fill="#fff"
          fontFamily="inherit"
        >
          {mark}
        </text>
      </svg>
    </Marker>
  );
}

interface PlacePinsProps {
  origin: Place | null;
  destination: Place | null;
}

/** Pins for the trip's chosen origin and destination. Must sit inside a `Map`. */
export function PlacePins({ origin, destination }: PlacePinsProps) {
  const theme = useTheme();

  return (
    <>
      {origin && <Pin kind="Origin" mark="A" color={theme.palette.primary.main} place={origin} />}
      {destination && (
        <Pin kind="Destination" mark="B" color={theme.palette.grey[800]} place={destination} />
      )}
    </>
  );
}
