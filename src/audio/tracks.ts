import { arp, hookLine, rootPulseBass, type Note } from './musicTheory';

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

// ---------------------------------------------------------------------------
// Developed-composition builder: a fixed 7-phrase (A/B/A/B/A/B/A-outro)
// structure so every gameplay track is a genuine 45-90 second arrangement --
// a restated melodic hook, a contrasting section, a moving bass line, and
// drum-density variation/fills -- instead of one short repeating loop.
// ---------------------------------------------------------------------------

const BEATS_PER_CHORD = 4;
const PHRASE_BEATS = BEATS_PER_CHORD * 4; // 4 chords per phrase

type DrumDensity = 'sparse' | 'full' | 'fill' | 'outro';

interface PhrasePlan {
  chords: 'A' | 'B';
  pattern: number[];
  octave: number;
  drums: DrumDensity;
  hook?: boolean;
}

const STRUCTURE: PhrasePlan[] = [
  { chords: 'A', pattern: [0, 1, 2, 1], octave: 1, drums: 'sparse' }, // verse: establishes the theme, restrained
  { chords: 'B', pattern: [0, 2, 1, 2], octave: 1, drums: 'full' }, // chorus: contrasting chords, fuller kit
  { chords: 'A', pattern: [0, 1, 2, 3, 2, 1, 0, 1], octave: 1, drums: 'full', hook: true }, // verse reprise + hook
  { chords: 'B', pattern: [2, 1, 0, 1], octave: 2, drums: 'fill' }, // bridge: octave lift, fill into the next section
  { chords: 'A', pattern: [0, 1, 2, 1], octave: 0, drums: 'sparse' }, // breakdown: octave down, quieter
  { chords: 'B', pattern: [0, 2, 1, 2, 0, 2, 1, 3], octave: 1, drums: 'full', hook: true }, // final chorus, busiest, hook returns
  { chords: 'A', pattern: [0, 1, 2, 1], octave: 1, drums: 'outro' }, // outro tail back into the loop point
];

function phraseDrums(startBeat: number, density: DrumDensity): DrumHit[] {
  const hits: DrumHit[] = [];
  if (density === 'sparse') {
    for (let b = 0; b < PHRASE_BEATS; b += 2) hits.push({ beat: startBeat + b, type: 'kick', gain: 0.7 });
    for (let b = 0; b < PHRASE_BEATS; b += 1) hits.push({ beat: startBeat + b, type: 'hat', gain: 0.2 });
  } else if (density === 'outro') {
    hits.push({ beat: startBeat, type: 'kick', gain: 0.6 });
    hits.push({ beat: startBeat + PHRASE_BEATS - 1, type: 'hat', gain: 0.3 });
  } else {
    for (let b = 0; b < PHRASE_BEATS; b += 1) hits.push({ beat: startBeat + b, type: 'kick', gain: 0.85 });
    for (let b = 0; b < PHRASE_BEATS; b += 0.5) hits.push({ beat: startBeat + b, type: 'hat', gain: 0.3 });
    for (const b of [2, 6, 10, 14]) hits.push({ beat: startBeat + b, type: 'snare', gain: 0.7 });
    if (density === 'fill') {
      for (const t of [14.5, 15, 15.5]) hits.push({ beat: startBeat + t, type: 'snare', gain: 0.45 + (t - 14) * 0.3 });
    }
  }
  return hits;
}

function buildDevelopedTrack(opts: {
  id: string;
  bpm: number;
  chordsA: number[][];
  chordsB: number[][];
  leadWave: OscillatorType;
  bassWave: OscillatorType;
  hookWave: OscillatorType;
  hookMotif: number[];
  leadGain?: number;
}): MusicTrack {
  const lead: Note[] = [];
  const bass: Note[] = [];
  const drums: DrumHit[] = [];
  const leadGain = opts.leadGain ?? 0.16;

  STRUCTURE.forEach((phrase, i) => {
    const startBeat = i * PHRASE_BEATS;
    const chords = phrase.chords === 'A' ? opts.chordsA : opts.chordsB;
    const noteDur = (BEATS_PER_CHORD / phrase.pattern.length) * 0.85;
    lead.push(...arp(startBeat, BEATS_PER_CHORD, chords, phrase.pattern, { wave: opts.leadWave, gain: leadGain, noteDur, octave: phrase.octave }));
    bass.push(...rootPulseBass(startBeat, BEATS_PER_CHORD, chords, { wave: opts.bassWave, gain: 0.32, octave: -1 }));
    if (phrase.hook) lead.push(...hookLine(startBeat, BEATS_PER_CHORD, chords, opts.hookMotif, { wave: opts.hookWave, gain: leadGain + 0.05, octave: 1 }));
    drums.push(...phraseDrums(startBeat, phrase.drums));
  });

  return { id: opts.id, bpm: opts.bpm, lengthBeats: STRUCTURE.length * PHRASE_BEATS, lead, bass, drums };
}

// C major: C E G | A minor: A C E | F major: F A C | G major: G B D
const MENU_CHORDS_A = [
  [60, 64, 67],
  [57, 60, 64],
  [65, 69, 72],
  [67, 71, 74],
];
// F major: F A C | G major: G B D | A minor: A C E | C major: C E G
const MENU_CHORDS_B = [
  [65, 69, 72],
  [67, 71, 74],
  [57, 60, 64],
  [60, 64, 67],
];

export const MENU_TRACK: MusicTrack = buildDevelopedTrack({
  id: 'menu',
  bpm: 130,
  chordsA: MENU_CHORDS_A,
  chordsB: MENU_CHORDS_B,
  leadWave: 'square',
  bassWave: 'triangle',
  hookWave: 'triangle',
  hookMotif: [0, 7, 12, 7],
});

// G major: G B D | E minor: E G B | C major: C E G | D major: D F# A
const CASTRO_CHORDS_A = [
  [67, 71, 74],
  [64, 67, 71],
  [60, 64, 67],
  [62, 66, 69],
];
// C major: C E G | D major: D F# A | E minor: E G B | G major: G B D
const CASTRO_CHORDS_B = [
  [60, 64, 67],
  [62, 66, 69],
  [64, 67, 71],
  [67, 71, 74],
];

export const CASTRO_STREET_TRACK: MusicTrack = buildDevelopedTrack({
  id: 'castro_street',
  bpm: 118,
  chordsA: CASTRO_CHORDS_A,
  chordsB: CASTRO_CHORDS_B,
  leadWave: 'triangle',
  bassWave: 'sine',
  hookWave: 'triangle',
  hookMotif: [0, 4, 7, 4, 0],
});

// D minor: D F A | C major: C E G | Bb major: Bb D F | A major: A C# E
const SAND_HILL_CHORDS_A = [
  [62, 65, 69],
  [60, 64, 67],
  [58, 62, 65],
  [57, 61, 64],
];
// Bb major: Bb D F | A major: A C# E | D minor: D F A | G minor: G Bb D
const SAND_HILL_CHORDS_B = [
  [58, 62, 65],
  [57, 61, 64],
  [62, 65, 69],
  [55, 58, 62],
];

export const SAND_HILL_ROAD_TRACK: MusicTrack = buildDevelopedTrack({
  id: 'sand_hill_road',
  bpm: 106,
  chordsA: SAND_HILL_CHORDS_A,
  chordsB: SAND_HILL_CHORDS_B,
  leadWave: 'square',
  bassWave: 'triangle',
  hookWave: 'sine',
  hookMotif: [0, 3, 7, 10],
});

// E minor: E G B | C major: C E G | G major: G B D | D major: D F# A
const PALO_ALTO_CHORDS_A = [
  [64, 67, 71],
  [60, 64, 67],
  [67, 71, 74],
  [62, 66, 69],
];
// C major: C E G | D major: D F# A | B minor: B D F# | G major: G B D
const PALO_ALTO_CHORDS_B = [
  [60, 64, 67],
  [62, 66, 69],
  [59, 62, 66],
  [67, 71, 74],
];

export const PALO_ALTO_TRACK: MusicTrack = buildDevelopedTrack({
  id: 'palo_alto',
  bpm: 142,
  chordsA: PALO_ALTO_CHORDS_A,
  chordsB: PALO_ALTO_CHORDS_B,
  leadWave: 'sawtooth',
  bassWave: 'square',
  hookWave: 'square',
  hookMotif: [0, 5, 7, 12, 7],
  leadGain: 0.14,
});

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
