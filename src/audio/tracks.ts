import { arp, sustainedChords, type Note } from './musicTheory';

export interface DrumHit {
  beat: number;
  type: 'kick' | 'snare' | 'hat';
  gain: number;
}

export interface MusicTrack {
  id: string;
  bpm: number;
  lengthBeats: number;
  lead: Note[];
  bass: Note[];
  drums: DrumHit[];
}

function fourOnFloorDrums(lengthBeats: number, opts: { kickEvery: number; hatEvery: number; snareBeats: number[] }): DrumHit[] {
  const hits: DrumHit[] = [];
  for (let b = 0; b < lengthBeats; b += opts.kickEvery) hits.push({ beat: b, type: 'kick', gain: 0.9 });
  for (let b = 0; b < lengthBeats; b += opts.hatEvery) hits.push({ beat: b, type: 'hat', gain: 0.35 });
  for (const b of opts.snareBeats) hits.push({ beat: b, type: 'snare', gain: 0.7 });
  return hits;
}

// C major: C E G | A minor: A C E | F major: F A C | G major: G B D
const MENU_CHORDS = [
  [60, 64, 67],
  [57, 60, 64],
  [65, 69, 72],
  [67, 71, 74],
];

export const MENU_TRACK: MusicTrack = {
  id: 'menu',
  bpm: 130,
  lengthBeats: 8,
  lead: arp(0, 2, MENU_CHORDS, [0, 1, 2, 1], { wave: 'square', gain: 0.16, noteDur: 0.45, octave: 1 }),
  bass: sustainedChords(0, 2, MENU_CHORDS, { wave: 'triangle', gain: 0.5, octave: -1 }).filter((_, i) => i % 3 === 0),
  drums: fourOnFloorDrums(8, { kickEvery: 2, hatEvery: 0.5, snareBeats: [2, 6] }),
};

// G major: G B D | E minor: E G B | C major: C E G | D major: D F# A
const CASTRO_CHORDS = [
  [67, 71, 74],
  [64, 67, 71],
  [60, 64, 67],
  [62, 66, 69],
];

export const CASTRO_STREET_TRACK: MusicTrack = {
  id: 'castro_street',
  bpm: 118,
  lengthBeats: 8,
  lead: arp(0, 2, CASTRO_CHORDS, [0, 2, 1, 2], { wave: 'triangle', gain: 0.2, noteDur: 0.42, octave: 1 }),
  bass: sustainedChords(0, 2, CASTRO_CHORDS, { wave: 'sine', gain: 0.6, octave: -1 }).filter((_, i) => i % 3 === 0),
  drums: fourOnFloorDrums(8, { kickEvery: 2, hatEvery: 1, snareBeats: [2, 6] }),
};

// D minor: D F A | C major: C E G | Bb major: Bb D F | A major: A C# E
const SAND_HILL_CHORDS = [
  [62, 65, 69],
  [60, 64, 67],
  [58, 62, 65],
  [57, 61, 64],
];

export const SAND_HILL_ROAD_TRACK: MusicTrack = {
  id: 'sand_hill_road',
  bpm: 106,
  lengthBeats: 8,
  lead: arp(0, 2, SAND_HILL_CHORDS, [0, 1, 2, 3, 2, 1], { wave: 'square', gain: 0.18, noteDur: 0.3, octave: 1 }),
  bass: sustainedChords(0, 2, SAND_HILL_CHORDS, { wave: 'triangle', gain: 0.55, octave: -1 }).filter((_, i) => i % 3 === 0),
  drums: fourOnFloorDrums(8, { kickEvery: 1, hatEvery: 0.5, snareBeats: [2, 6] }),
};

// E minor: E G B | C major: C E G | G major: G B D | D major: D F# A
const PALO_ALTO_CHORDS = [
  [64, 67, 71],
  [60, 64, 67],
  [67, 71, 74],
  [62, 66, 69],
];

export const PALO_ALTO_TRACK: MusicTrack = {
  id: 'palo_alto',
  bpm: 142,
  lengthBeats: 8,
  lead: arp(0, 2, PALO_ALTO_CHORDS, [0, 1, 2, 1, 0, 1, 2, 3], { wave: 'sawtooth', gain: 0.15, noteDur: 0.22, octave: 1 }),
  bass: sustainedChords(0, 2, PALO_ALTO_CHORDS, { wave: 'square', gain: 0.5, octave: -1 }).filter((_, i) => i % 3 === 0),
  drums: fourOnFloorDrums(8, { kickEvery: 0.5, hatEvery: 0.5, snareBeats: [2, 4, 6] }),
};

export const VICTORY_STING: MusicTrack = {
  id: 'victory',
  bpm: 150,
  lengthBeats: 4.5,
  lead: [
    { beat: 0, freq: 523.25, dur: 0.4, wave: 'square', gain: 0.25 },
    { beat: 0.5, freq: 659.25, dur: 0.4, wave: 'square', gain: 0.25 },
    { beat: 1, freq: 783.99, dur: 0.4, wave: 'square', gain: 0.25 },
    { beat: 1.5, freq: 1046.5, dur: 0.9, wave: 'square', gain: 0.28 },
    { beat: 2.5, freq: 783.99, dur: 0.4, wave: 'square', gain: 0.22 },
    { beat: 3, freq: 1046.5, dur: 1.4, wave: 'square', gain: 0.3 },
  ],
  bass: [
    { beat: 0, freq: 130.81, dur: 1.4, wave: 'triangle', gain: 0.4 },
    { beat: 1.5, freq: 130.81, dur: 1.4, wave: 'triangle', gain: 0.4 },
    { beat: 3, freq: 196.0, dur: 1.4, wave: 'triangle', gain: 0.4 },
  ],
  drums: [
    { beat: 0, type: 'kick', gain: 0.8 },
    { beat: 1.5, type: 'kick', gain: 0.8 },
    { beat: 3, type: 'kick', gain: 0.9 },
  ],
};

export const MUSIC_TRACKS: Record<string, MusicTrack> = {
  menu: MENU_TRACK,
  castro_street: CASTRO_STREET_TRACK,
  sand_hill_road: SAND_HILL_ROAD_TRACK,
  palo_alto: PALO_ALTO_TRACK,
  victory: VICTORY_STING,
};
