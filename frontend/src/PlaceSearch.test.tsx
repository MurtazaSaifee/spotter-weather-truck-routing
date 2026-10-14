import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlaceSuggestions } from './api/places';
import { chicago, dallas, hereSuggestions, photonSuggestions } from './test/fixtures/places';
import { renderApp } from './test/renderApp';
import { server } from './test/server';

// The only mock in the suite: WebGL is unavailable in jsdom.
vi.mock('./map/TripMap', () => import('./test/tripMapStub'));

const SUGGEST_PATH = '/api/places/suggest';

/** Answers every suggestion request with `body` and records the queries it receives. */
function answerSuggestionsWith(body: PlaceSuggestions) {
  const queries: string[] = [];
  server.use(
    http.get(SUGGEST_PATH, ({ request }) => {
      queries.push(new URL(request.url).searchParams.get('q') ?? '');
      return HttpResponse.json(body);
    }),
  );
  return queries;
}

function pinLabel(kind: 'Origin' | 'Destination') {
  return screen.queryByRole('img', { name: `${kind} pin` });
}

beforeEach(() => {
  answerSuggestionsWith(hereSuggestions);
});

describe('place search', () => {
  it('suggests places after typing, once the typing pauses', async () => {
    const queries = answerSuggestionsWith(hereSuggestions);
    const user = userEvent.setup();
    renderApp();

    await user.type(screen.getByRole('combobox', { name: 'Origin' }), 'Chicago');

    // Typing seven letters must not send seven requests, and none goes out immediately.
    expect(queries).toEqual([]);
    expect(await screen.findByRole('option', { name: chicago.label })).toBeInTheDocument();
    expect(queries).toEqual(['Chicago']);
  });

  it('selecting a suggestion fills the field and drops a pin carrying its coordinates and time zone', async () => {
    const user = userEvent.setup();
    renderApp();
    const origin = screen.getByRole('combobox', { name: 'Origin' });
    await user.type(origin, 'Chicago');

    await user.click(await screen.findByRole('option', { name: chicago.label }));

    expect(origin).toHaveValue(chicago.label);
    expect(pinLabel('Origin')).toHaveTextContent(
      `${chicago.label} @ ${chicago.lat},${chicago.lng} (America/Chicago)`,
    );
    expect(pinLabel('Destination')).not.toBeInTheDocument();
  });

  it('searches the destination the same way, independently of the origin', async () => {
    answerSuggestionsWith({ provider: 'here', suggestions: [dallas] });
    const user = userEvent.setup();
    renderApp();
    await user.type(screen.getByRole('combobox', { name: 'Destination' }), 'Dallas');

    await user.click(await screen.findByRole('option', { name: dallas.label }));

    expect(pinLabel('Destination')).toHaveTextContent(dallas.label);
    expect(pinLabel('Origin')).not.toBeInTheDocument();
  });

  it('removes the pin when the field is cleared with the clear button', async () => {
    const user = userEvent.setup();
    renderApp();
    await user.type(screen.getByRole('combobox', { name: 'Origin' }), 'Chicago');
    await user.click(await screen.findByRole('option', { name: chicago.label }));
    expect(pinLabel('Origin')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Clear' }));

    expect(screen.getByRole('combobox', { name: 'Origin' })).toHaveValue('');
    expect(pinLabel('Origin')).not.toBeInTheDocument();
  });

  it('removes the pin when the text is deleted', async () => {
    const user = userEvent.setup();
    renderApp();
    const origin = screen.getByRole('combobox', { name: 'Origin' });
    await user.type(origin, 'Chicago');
    await user.click(await screen.findByRole('option', { name: chicago.label }));

    await user.clear(origin);

    expect(pinLabel('Origin')).not.toBeInTheDocument();
  });

  it('does not search until three characters are typed', async () => {
    const queries = answerSuggestionsWith(hereSuggestions);
    const user = userEvent.setup();
    renderApp();

    await user.type(screen.getByRole('combobox', { name: 'Origin' }), 'Ch');

    expect(await screen.findByText('Type at least 3 characters')).toBeInTheDocument();
    // Longer than the debounce, so a request would have gone out by now.
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(queries).toEqual([]);
  });

  it('shows a loading state while suggestions are on their way', async () => {
    let respond!: () => void;
    const released = new Promise<void>((resolve) => {
      respond = resolve;
    });
    server.use(
      http.get(SUGGEST_PATH, async () => {
        await released;
        return HttpResponse.json(hereSuggestions);
      }),
    );
    const user = userEvent.setup();
    renderApp();

    await user.type(screen.getByRole('combobox', { name: 'Origin' }), 'Chicago');

    expect(await screen.findByText('Searching…')).toBeInTheDocument();
    respond();
    expect(await screen.findByRole('option', { name: chicago.label })).toBeInTheDocument();
    expect(screen.queryByText('Searching…')).not.toBeInTheDocument();
  });

  it('says so when nothing matches', async () => {
    answerSuggestionsWith({ provider: 'here', suggestions: [] });
    const user = userEvent.setup();
    renderApp();

    await user.type(screen.getByRole('combobox', { name: 'Origin' }), 'Zzzzzz');

    expect(await screen.findByText('No places found')).toBeInTheDocument();
  });

  it("shows the API's message when place search is unavailable", async () => {
    server.use(
      http.get(SUGGEST_PATH, () =>
        HttpResponse.json(
          {
            code: 'places_unavailable',
            message: 'Place search is unavailable right now. Please try again.',
          },
          { status: 503 },
        ),
      ),
    );
    const user = userEvent.setup();
    renderApp();

    await user.type(screen.getByRole('combobox', { name: 'Origin' }), 'Chicago');

    expect(
      await screen.findByText('Place search is unavailable right now. Please try again.'),
    ).toBeInTheDocument();
  });

  it('credits HERE beside suggestions that came from HERE', async () => {
    const user = userEvent.setup();
    renderApp();

    await user.type(screen.getByRole('combobox', { name: 'Origin' }), 'Chicago');

    expect(await screen.findByText('Powered by HERE')).toBeVisible();
    expect(screen.queryByText(/Photon/)).not.toBeInTheDocument();
  });

  it('credits Photon and OpenStreetMap beside fallback suggestions', async () => {
    answerSuggestionsWith(photonSuggestions);
    const user = userEvent.setup();
    renderApp();

    await user.type(screen.getByRole('combobox', { name: 'Origin' }), 'Chicago');

    expect(await screen.findByText(/Photon · © OpenStreetMap contributors/)).toBeVisible();
    expect(screen.queryByText('Powered by HERE')).not.toBeInTheDocument();
  });
});
