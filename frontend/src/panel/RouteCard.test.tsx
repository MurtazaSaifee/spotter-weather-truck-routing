import { ThemeProvider } from '@mui/material/styles';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { PlannedRoute } from '../api/plan';
import { routeOne, routeThree } from '../test/fixtures/plan';
import { theme } from '../theme';
import { RouteCard } from './RouteCard';

const CHICAGO = 'America/Chicago';

/** 927 mi, 14 h 55 min, arriving Thu Oct 15 at 10:54 PM CDT; 26.8 mi unassessed. */
const clear: PlannedRoute = {
  ...routeOne,
  risk_miles: { ...routeOne.risk_miles, high: 12.5, severe: 50, no_travel: 0 },
};

function renderCard(
  route: PlannedRoute,
  props: Partial<{ label: string; recommended: boolean; selected: boolean }> = {},
) {
  const onSelect = vi.fn();
  render(
    <ThemeProvider theme={theme}>
      <RouteCard
        route={route}
        label={props.label ?? `Route ${route.rank}`}
        recommended={props.recommended ?? false}
        timeZone={CHICAGO}
        selected={props.selected ?? false}
        onSelect={onSelect}
      />
    </ThemeProvider>,
  );
  return { card: screen.getByRole('button'), onSelect };
}

describe('RouteCard', () => {
  it('shows the name, distance, travel time, arrival in the origin zone, risk miles and average risk', () => {
    const { card } = renderCard(clear, { label: 'Route 1' });

    expect(card).toHaveTextContent(/^Route 1/);
    expect(card).toHaveTextContent('Distance 927 mi');
    expect(card).toHaveTextContent('Travel time 14 h 55 min');
    expect(card).toHaveTextContent('Arrives 10:54 PM CDT Thu Oct 15');
    expect(card).toHaveTextContent('Average risk 0.45');
    expect(card).toHaveTextContent('Severe 50 mi');
    expect(card).toHaveTextContent('High 12.5 mi');
    expect(card).toHaveTextContent('No Travel 0 mi');
    expect(card).toHaveTextContent('Unassessed 26.8 mi');
  });

  it('says n/a when no average risk could be worked out', () => {
    const { card } = renderCard({ ...routeOne, average_risk: null });

    expect(card).toHaveTextContent('Average risk n/a');
  });

  it('keeps the card to the figures: no rank line, no explanation', () => {
    const { card } = renderCard(routeOne, { label: 'Route 1', recommended: true });

    expect(card).not.toHaveTextContent(/rank/i);
    expect(card).not.toHaveTextContent(/\bof 3\b/);
  });

  it('marks a recommended route and nothing else', () => {
    const { card } = renderCard(routeOne, { recommended: true });

    expect(card).toHaveTextContent('Recommended');
    expect(card).not.toHaveTextContent('Blocked');
  });

  it('marks neither status on an ordinary route', () => {
    const { card } = renderCard(routeOne);

    expect(card).not.toHaveTextContent('Recommended');
    expect(card).not.toHaveTextContent('Blocked');
    expect(card).toHaveStyle({ borderStyle: 'solid' });
  });

  it('marks a blocked route, with a dashed border', () => {
    const { card } = renderCard(routeThree);

    expect(routeThree.blocked).toBe(true);
    expect(card).toHaveTextContent('Blocked by No Travel');
    expect(card).not.toHaveTextContent('Recommended');
    expect(card).toHaveStyle({ borderStyle: 'dashed' });
  });

  it('keeps a selected blocked route dashed', () => {
    const { card } = renderCard(routeThree, { selected: true });

    expect(card).toHaveAttribute('aria-pressed', 'true');
    expect(card).toHaveStyle({ borderStyle: 'dashed' });
  });

  it('is a toggle button: pressed only when selected', () => {
    const { card } = renderCard(routeOne, { selected: true });

    expect(card).toHaveAttribute('aria-pressed', 'true');
  });

  it('is not pressed when it is not selected', () => {
    const { card } = renderCard(routeOne, { selected: false });

    expect(card).toHaveAttribute('aria-pressed', 'false');
  });

  it('selects the route when pressed, by mouse or by keyboard', async () => {
    const user = userEvent.setup();
    const { card, onSelect } = renderCard(routeOne);

    await user.click(card);
    expect(onSelect).toHaveBeenCalledTimes(1);

    await user.keyboard('{Enter}');
    expect(onSelect).toHaveBeenCalledTimes(2);
  });

  it('shows a focus ring when reached with the keyboard', async () => {
    const user = userEvent.setup();
    const { card } = renderCard(routeOne);

    await user.tab();

    expect(card).toHaveFocus();
    expect(card).toHaveClass('Mui-focusVisible');
  });
});
