import { createTheme } from '@mui/material/styles';

// "Inter Variable" is the family name registered by @fontsource-variable/inter
// (imported once in main.tsx).
const FONT_FAMILY = [
  '"Inter Variable"',
  'Inter',
  '-apple-system',
  'BlinkMacSystemFont',
  '"Segoe UI"',
  'Roboto',
  'sans-serif',
].join(',');

export const theme = createTheme({
  palette: {
    mode: 'light',
    primary: { main: '#1a4590', light: '#4a72b8', dark: '#112f68' },
    secondary: { main: '#475569' },
    grey: {
      50: '#f8f9fb',
      100: '#f1f3f6',
      200: '#e3e6ec',
      300: '#cdd2db',
      400: '#9ba3b2',
      500: '#6b7385',
      600: '#4f5768',
      700: '#3b4252',
      800: '#262c3a',
      900: '#161b26',
    },
    background: { default: '#f5f6f8', paper: '#ffffff' },
    text: { primary: '#1c2433', secondary: '#586174' },
    divider: '#e3e6ec',
  },
  shape: { borderRadius: 8 },
  typography: {
    fontFamily: FONT_FAMILY,
    h1: { fontSize: '1.375rem', fontWeight: 650, lineHeight: 1.25, letterSpacing: '-0.01em' },
    button: { textTransform: 'none', fontWeight: 600 },
  },
  components: {
    MuiButton: { defaultProps: { disableElevation: true } },
    MuiPaper: { defaultProps: { elevation: 0 } },
  },
});
