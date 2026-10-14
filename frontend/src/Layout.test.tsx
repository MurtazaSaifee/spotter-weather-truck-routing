import { screen, within } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { heatmapOfChicagoToDallas } from './test/fixtures/heatmap';
import { chicago, dallas } from './test/fixtures/places';
import { chicagoToDallas } from './test/fixtures/plan';
import { renderApp } from './test/renderApp';
import { server } from './test/server';

// The only mock in the suite: WebGL is unavailable in jsdom.
vi.mock('./map/TripMap', () => import('./test/tripMapStub'));

const NOW = new Date('2026-10-14T17:20:00Z');

function answerPlans() {
  server.use(
    http.get('/api/places/suggest', () =>
      HttpResponse.json({ provider: 'here', suggestions: [chicago, dallas] }),
    ),
    http.post('/api/plan', () => HttpResponse.json(chicagoToDallas)),
    http.post('/api/heatmap', () => HttpResponse.json(heatmapOfChicagoToDallas)),
  );
}

async function planChicagoToDallas(user: UserEvent) {
  await user.type(await screen.findByRole('combobox', { name: 'Origin' }), 'Chicago');
  await user.click(await screen.findByRole('option', { name: chicago.label }));
  await user.type(screen.getByRole('combobox', { name: 'Destination' }), 'Dallas');
  await user.click(await screen.findByRole('option', { name: dallas.label }));
  await user.type(screen.getByRole('textbox', { name: 'Load weight' }), '42000');
  await user.click(screen.getByRole('button', { name: 'Plan trip' }));
}

const hoursSlider = () => screen.findByRole('slider', { name: 'Hours after departure' });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  answerPlans();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('on a desktop', () => {
  it('holds the forecast strip open before a trip is planned, so the map keeps its size', () => {
    renderApp();

    const strip = screen.getByRole('region', { name: 'Forecast controls' });
    expect(within(strip).getByText(/Plan a trip to see the weather/)).toBeInTheDocument();
    expect(within(strip).queryByRole('slider')).not.toBeInTheDocument();
  });

  it('puts the forecast controls under the map, outside the planner panel', async () => {
    const user = userEvent.setup();
    renderApp();
    await planChicagoToDallas(user);
    await hoursSlider();

    const panel = screen.getByRole('complementary', { name: 'Trip planner' });
    expect(within(panel).queryByRole('slider')).not.toBeInTheDocument();
    expect(
      within(screen.getByRole('region', { name: 'Forecast controls' })).getByRole('slider'),
    ).toBeInTheDocument();
  });

  it('lets the heatmap layer be chosen from the keyboard', async () => {
    const user = userEvent.setup();
    renderApp();
    await planChicagoToDallas(user);
    await hoursSlider();

    const wind = screen.getByRole('button', { name: 'Wind' });
    wind.focus();
    await user.keyboard('{Enter}');
    expect(wind).toHaveAttribute('aria-pressed', 'true');
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('button', { name: 'Rain' })).toHaveFocus();
    await user.keyboard('[Space]');
    expect(screen.getByRole('button', { name: 'Rain' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('selects a route card from the keyboard', async () => {
    const user = userEvent.setup();
    renderApp();
    await planChicagoToDallas(user);

    const cards = within(await screen.findByRole('region', { name: 'Routes' })).getAllByRole('button');
    const unselected = cards.find((card) => card.getAttribute('aria-pressed') === 'false');
    expect(unselected).toBeDefined();
    unselected!.focus();
    await user.keyboard('{Enter}');
    expect(unselected).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('on a phone', () => {
  const desktopMatchMedia = window.matchMedia.bind(window);

  beforeEach(() => {
    // Narrower than MUI's `md` breakpoint (900 px).
    window.matchMedia = (query: string) => ({
      ...desktopMatchMedia(query),
      matches: query.includes('max-width'),
    });
  });

  afterEach(() => {
    window.matchMedia = desktopMatchMedia;
  });

  const sheetHeader = () =>
    within(screen.getByRole('complementary', { name: 'Trip planner' })).getByRole('button', {
      name: /Drag, or press Up and Down arrows, to resize/,
    });

  it('starts with the sheet half open, holding the trip form', () => {
    renderApp();

    expect(sheetHeader()).toHaveAccessibleName(/Panel half open/);
    expect(sheetHeader()).toHaveAttribute('aria-expanded', 'true');
    const panel = screen.getByRole('complementary', { name: 'Trip planner' });
    expect(within(panel).getByRole('textbox', { name: 'Load weight' })).toBeInTheDocument();
  });

  it('shows the recommendation in the sheet header once the trip is planned', async () => {
    const user = userEvent.setup();
    renderApp();
    await planChicagoToDallas(user);

    expect(await screen.findByRole('region', { name: 'Recommended route' })).toBeInTheDocument();
    expect(sheetHeader()).toHaveAccessibleName(/Route 1 recommended\. 927 mi/);
    const panel = screen.getByRole('complementary', { name: 'Trip planner' });
    expect(within(panel).getByRole('region', { name: 'Why this route' })).toBeInTheDocument();
    expect(within(panel).getByRole('region', { name: 'Routes' })).toBeInTheDocument();
  });

  it('keeps the layer toggle and the slider over the map, not in the sheet', async () => {
    const user = userEvent.setup();
    renderApp();
    await planChicagoToDallas(user);
    const slider = await hoursSlider();

    const panel = screen.getByRole('complementary', { name: 'Trip planner' });
    expect(panel).not.toContainElement(slider);
    expect(within(panel).queryByRole('button', { name: 'Wind' })).not.toBeInTheDocument();
  });

  it('opens and closes with a tap and the arrow keys, taking the form out of reach while collapsed', async () => {
    const user = userEvent.setup();
    renderApp();
    const weight = screen.getByRole('textbox', { name: 'Load weight' });

    sheetHeader().focus();
    await user.keyboard('{ArrowDown}');
    expect(sheetHeader()).toHaveAccessibleName(/Panel collapsed/);
    expect(sheetHeader()).toHaveAttribute('aria-expanded', 'false');
    expect(weight.closest('[inert]')).not.toBeNull();

    await user.click(sheetHeader());
    expect(sheetHeader()).toHaveAccessibleName(/Panel half open/);
    expect(weight.closest('[inert]')).toBeNull();

    await user.keyboard('{ArrowUp}');
    expect(sheetHeader()).toHaveAccessibleName(/Panel fully open/);
    await user.keyboard('{ArrowUp}');
    expect(sheetHeader()).toHaveAccessibleName(/Panel fully open/);
  });

  it('opens fully when a field is focused, to make room for the keyboard', async () => {
    const user = userEvent.setup();
    renderApp();

    await user.click(screen.getByRole('textbox', { name: 'Load weight' }));

    expect(sheetHeader()).toHaveAccessibleName(/Panel fully open/);
  });

  it('rises to half open when the results arrive', async () => {
    const user = userEvent.setup();
    renderApp();
    await planChicagoToDallas(user); // typing in the form opened the sheet fully

    await screen.findByRole('region', { name: 'Recommended route' });

    expect(sheetHeader()).toHaveAccessibleName(/Panel half open/);
  });
});
