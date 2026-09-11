import type { StageId } from '../../sim/types';

export interface StagePalette {
  sky: [string, string]; // gradient top/bottom
  far: string;
  mid: string;
  near: string;
  floor: string;
  accent: string;
  neon: string;
}

export interface StageDef {
  id: StageId;
  name: string;
  location: string;
  palette: StagePalette;
  signs: string[];
  musicTrackId: string;
  description: string;
}

export const STAGES: Record<StageId, StageDef> = {
  castro_street: {
    id: 'castro_street',
    name: 'Castro Street Coffee Clash',
    location: 'Mountain View',
    palette: {
      sky: ['#f0a868', '#f7d9a0'],
      far: '#c98a5e',
      mid: '#a9673f',
      near: '#5b3a2a',
      floor: '#3a2a22',
      accent: '#2fb6a8',
      neon: '#7a4fae',
    },
    signs: ['Wi-Fi: UNICORN_GUEST', '$9 Pour Over', 'No Pitches After 5'],
    musicTrackId: 'castro_street',
    description: 'Warm late-afternoon light on a downtown coffee shop patio.',
  },
  sand_hill_road: {
    id: 'sand_hill_road',
    name: 'Sand Hill Road Showdown',
    location: 'Menlo Park',
    palette: {
      sky: ['#31304a', '#7a6a8f'],
      far: '#4a4468',
      mid: '#2f2c46',
      near: '#1c1a2c',
      floor: '#151322',
      accent: '#d4af37',
      neon: '#c9497a',
    },
    signs: ['WE FUND VISION', 'NO WALK-IN PITCHES', 'REVENUE OPTIONAL'],
    musicTrackId: 'sand_hill_road',
    description: 'A pristine venture-capital office entrance at sunset.',
  },
  palo_alto: {
    id: 'palo_alto',
    name: 'Palo Alto Launch Night',
    location: 'Palo Alto',
    palette: {
      sky: ['#050818', '#182a4a'],
      far: '#122040',
      mid: '#0c1930',
      near: '#080f20',
      floor: '#05070f',
      accent: '#38e0e0',
      neon: '#8a3ffc',
    },
    signs: ['DEMO DAY', 'MOVE FAST', 'LIVE DEMO: PROBABLY READY'],
    musicTrackId: 'palo_alto',
    description: 'A rooftop after dark, with a distant rocket gantry.',
  },
};

export function getStage(id: StageId): StageDef {
  return STAGES[id];
}
