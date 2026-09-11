export function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

export interface Note {
  beat: number;
  freq: number;
  dur: number;
  wave: OscillatorType;
  gain: number;
}

/**
 * Builds an arpeggio line: walks the given chords in order (each held for
 * `beatsPerChord` beats), playing `pattern` (chord-tone indices, e.g.
 * [0,1,2,1] for root-third-fifth-third) once per beat within each chord.
 */
export function arp(startBeat: number, beatsPerChord: number, chords: number[][], pattern: number[], opts: { wave: OscillatorType; gain: number; noteDur: number; octave?: number }): Note[] {
  const notes: Note[] = [];
  const stepDur = beatsPerChord / pattern.length;
  chords.forEach((chord, chordIdx) => {
    for (let i = 0; i < pattern.length; i++) {
      const midi = chord[pattern[i] % chord.length] + (opts.octave ?? 0) * 12;
      notes.push({
        beat: startBeat + chordIdx * beatsPerChord + i * stepDur,
        freq: midiToFreq(midi),
        dur: opts.noteDur,
        wave: opts.wave,
        gain: opts.gain,
      });
    }
  });
  return notes;
}

export function sustainedChords(startBeat: number, beatsPerChord: number, chords: number[][], opts: { wave: OscillatorType; gain: number; octave?: number }): Note[] {
  const notes: Note[] = [];
  chords.forEach((chord, chordIdx) => {
    for (const tone of chord) {
      notes.push({
        beat: startBeat + chordIdx * beatsPerChord,
        freq: midiToFreq(tone + (opts.octave ?? 0) * 12),
        dur: beatsPerChord * 0.95,
        wave: opts.wave,
        gain: opts.gain / chord.length,
      });
    }
  });
  return notes;
}

/** A moving bass line: the chord root pulses twice per chord instead of sitting as one static sustain, giving the low end forward motion. */
export function rootPulseBass(startBeat: number, beatsPerChord: number, chords: number[][], opts: { wave: OscillatorType; gain: number; octave?: number }): Note[] {
  const notes: Note[] = [];
  const half = beatsPerChord / 2;
  chords.forEach((chord, chordIdx) => {
    const root = chord[0] + (opts.octave ?? 0) * 12;
    notes.push({ beat: startBeat + chordIdx * beatsPerChord, freq: midiToFreq(root), dur: half * 0.85, wave: opts.wave, gain: opts.gain });
    notes.push({ beat: startBeat + chordIdx * beatsPerChord + half, freq: midiToFreq(root), dur: half * 0.7, wave: opts.wave, gain: opts.gain * 0.75 });
  });
  return notes;
}

/**
 * A short, fixed melodic contour (scale-degree offsets in semitones relative
 * to each chord's root) restated once per chord at a slower rate than the
 * arpeggio underneath it, so the piece has one identifiable hook a listener
 * can hum instead of only an arpeggiated backing pattern.
 */
export function hookLine(startBeat: number, beatsPerChord: number, chords: number[][], motif: number[], opts: { wave: OscillatorType; gain: number; octave?: number }): Note[] {
  const notes: Note[] = [];
  const stepDur = beatsPerChord / motif.length;
  chords.forEach((chord, chordIdx) => {
    const root = chord[0] + (opts.octave ?? 0) * 12;
    motif.forEach((offset, i) => {
      notes.push({
        beat: startBeat + chordIdx * beatsPerChord + i * stepDur,
        freq: midiToFreq(root + offset),
        dur: stepDur * 0.85,
        wave: opts.wave,
        gain: opts.gain,
      });
    });
  });
  return notes;
}
