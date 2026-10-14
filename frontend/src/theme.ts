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

/** Smallest comfortable touch target, in px (WCAG 2.5.5 and platform guidance). */
export const TOUCH_TARGET = 44;

/**
 * One scale for the whole app, on MUI's 8 px spacing unit:
 * - the panel pads 3 (24 px) on desktop and 2 (16 px) in the phone sheet;
 * - sections of the panel are 3 apart, the blocks inside a section 2 apart, and tight
 *   groups (a heading over its text, chips in a row) 0.5 to 1 apart;
 * - every card pads 2 and has a 12 px radius.
 * And one type hierarchy: h1 the app title, subtitle1 a section or card heading, subtitle2 a
 * label inside a card, body1 the key line of a card, body2 supporting text, caption notes.
 */
export const theme = createTheme({
  palette: {
    mode: 'light',
    primary: { main: '#1a4590', light: '#4a72b8', dark: '#112f68' },
    secondary: { main: '#475569' },
    // Success text and fills are checked against white and the tint below (AA, 4.5:1).
    success: { main: '#1b6e3c', light: '#e7f5ec', dark: '#124d29', contrastText: '#ffffff' },
    error: { main: '#c62828', contrastText: '#ffffff' },
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
    h1: { fontSize: '1.25rem', fontWeight: 650, lineHeight: 1.25, letterSpacing: '-0.01em' },
    subtitle1: { fontSize: '1rem', fontWeight: 650, lineHeight: 1.35 },
    subtitle2: { fontSize: '0.875rem', fontWeight: 600, lineHeight: 1.4 },
    body1: { fontSize: '0.9375rem', lineHeight: 1.5 },
    body2: { fontSize: '0.875rem', lineHeight: 1.5 },
    caption: { fontSize: '0.75rem', lineHeight: 1.45 },
    button: { textTransform: 'none', fontWeight: 600 },
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: (theme) => ({
        // Keyboard focus is always visible, on buttons MUI leaves unmarked (the route cards)
        // as much as on the rest. Text fields already draw their own focus border.
        '*:focus-visible': {
          outline: `2px solid ${theme.palette.primary.main}`,
          outlineOffset: 2,
        },
        '.MuiInputBase-input:focus-visible, .MuiSlider-thumb input:focus-visible': {
          outline: 'none',
        },
        // The page never scrolls: the panel and the sheet do.
        'html, body, #root': { height: '100%', overscrollBehavior: 'none' },
        '@media (prefers-reduced-motion: reduce)': {
          '*, *::before, *::after': {
            animationDuration: '0.01ms !important',
            transitionDuration: '0.01ms !important',
          },
        },
      }),
    },
    MuiPaper: {
      defaultProps: { elevation: 0 },
      styleOverrides: { rounded: { borderRadius: 12 } },
    },
    MuiChip: { styleOverrides: { label: { fontWeight: 600 } } },
    // Below `md` the app is a phone layout: everything pressed with a thumb is 44 px or more.
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: ({ theme }) => ({
          [theme.breakpoints.down('md')]: { minHeight: TOUCH_TARGET },
        }),
      },
    },
    MuiToggleButton: {
      styleOverrides: {
        root: ({ theme }) => ({
          fontWeight: 600,
          [theme.breakpoints.down('md')]: { minHeight: TOUCH_TARGET, minWidth: TOUCH_TARGET },
        }),
      },
    },
    MuiIconButton: {
      styleOverrides: {
        root: ({ theme }) => ({
          [theme.breakpoints.down('md')]: {
            // Keep the glyph where it is and grow only what can be hit.
            position: 'relative',
            '&::after': {
              content: '""',
              position: 'absolute',
              top: '50%',
              left: '50%',
              width: TOUCH_TARGET,
              height: TOUCH_TARGET,
              transform: 'translate(-50%, -50%)',
            },
          },
        }),
      },
    },
  },
});
