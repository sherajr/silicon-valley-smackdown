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
