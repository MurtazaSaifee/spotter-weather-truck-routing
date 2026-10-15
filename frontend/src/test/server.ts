import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { heatmapOfChicagoToDallas } from './fixtures/heatmap';

const handlers = [
  // Every plan on screen asks for its heatmap; tests about it override this.
  http.post('/api/heatmap', () => HttpResponse.json(heatmapOfChicagoToDallas)),
];

export const server = setupServer(...handlers);
