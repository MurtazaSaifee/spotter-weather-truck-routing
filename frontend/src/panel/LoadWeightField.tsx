import { InputAdornment, TextField } from '@mui/material';
import { useState } from 'react';
import { formatWeightInput, parseWeight, weightError } from '../trip/weight';

interface LoadWeightFieldProps {
  /** What is typed, with thousands separators. */
  text: string;
  onTextChange: (text: string) => void;
}

/** Cargo weight in pounds, grouped with thousands separators as it is typed. */
export function LoadWeightField({ text, onTextChange }: LoadWeightFieldProps) {
  // An empty field is not an error until the driver has been in it and left.
  const [touched, setTouched] = useState(false);
  const pounds = parseWeight(text);
  const message = weightError(pounds);
  const showError = message !== null && (pounds !== null || touched);

  return (
    <TextField
      label="Load weight"
      value={text}
      onChange={(event) => onTextChange(formatWeightInput(event.target.value))}
      onBlur={() => setTouched(true)}
      error={showError}
      helperText={showError ? message : undefined}
      slotProps={{
        input: { endAdornment: <InputAdornment position="end">lb</InputAdornment> },
        htmlInput: { inputMode: 'numeric', autoComplete: 'off' },
      }}
    />
  );
}
