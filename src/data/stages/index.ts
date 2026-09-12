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
      sky: ['#35126b', '#ff36c8'],
      far: '#6329a3',
      mid: '#177caa',
      near: '#18345c',
      floor: '#241052',
      accent: '#00e5ff',
      neon: '#fff23d',
    },
    signs: ['Wi-Fi: UNICORN_GUEST', '$9 Pour Over', 'No Pitches After 5'],
    musicTrackId: 'castro_street',
    description: 'A magenta sunset, cyan storefronts, and yellow coffee-shop signs.',
  },
  sand_hill_road: {
    id: 'sand_hill_road',
    name: 'Sand Hill Road Showdown',
    location: 'Menlo Park',
    palette: {
      sky: ['#100a30', '#51228c'],
      far: '#af238c',
      mid: '#197b9e',
      near: '#302363',
      floor: '#1b1043',
      accent: '#fff23d',
      neon: '#00e5ff',
    },
    signs: ['WE FUND VISION', 'NO WALK-IN PITCHES', 'REVENUE OPTIONAL'],
    musicTrackId: 'sand_hill_road',
    description: 'A neon venture-capital plaza with cyan glass and yellow trim.',
  },
  palo_alto: {
    id: 'palo_alto',
    name: 'Palo Alto Launch Night',
    location: 'Palo Alto',
    palette: {
      sky: ['#100a30', '#242d78'],
      far: '#633bb1',
      mid: '#116988',
      near: '#34205c',
      floor: '#171039',
      accent: '#ff36c8',
      neon: '#fff23d',
    },
    signs: ['DEMO DAY', 'MOVE FAST', 'LIVE DEMO: PROBABLY READY'],
    musicTrackId: 'palo_alto',
    description: 'A violet rooftop with magenta lights and a distant rocket gantry.',
  },
};

export function getStage(id: StageId): StageDef {
  return STAGES[id];
}
