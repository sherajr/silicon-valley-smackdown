import { describe, expect, it } from 'vitest';
import { CASTRO_STREET_TRACK, MENU_TRACK, PALO_ALTO_TRACK, SAND_HILL_ROAD_TRACK, MUSIC_TRACKS } from './tracks';

function durationSeconds(track: { bpm: number; lengthBeats: number }): number {
  return (track.lengthBeats * 60) / track.bpm;
}

describe('developed gameplay tracks', () => {
  const gameplayTracks = [MENU_TRACK, CASTRO_STREET_TRACK, SAND_HILL_ROAD_TRACK, PALO_ALTO_TRACK];

  it('run 45-90 seconds per loop instead of a few-second arpeggio loop', () => {
    for (const track of gameplayTracks) {
      const seconds = durationSeconds(track);
      expect(seconds).toBeGreaterThanOrEqual(45);
      expect(seconds).toBeLessThanOrEqual(90);
    }
  });

  it('carries a real bass line and drum variation, not just a lead arpeggio', () => {
    for (const track of gameplayTracks) {
      expect(track.bass.length).toBeGreaterThan(8);
      expect(track.drums.length).toBeGreaterThan(16);
      const drumTypes = new Set(track.drums.map((d) => d.type));
      expect(drumTypes.has('kick')).toBe(true);
      expect(drumTypes.has('snare')).toBe(true);
      expect(drumTypes.has('hat')).toBe(true);
    }
  });

  it('produces only finite, positive frequencies and durations (no malformed notes)', () => {
    for (const track of gameplayTracks) {
      for (const n of [...track.lead, ...track.bass]) {
        expect(Number.isFinite(n.freq)).toBe(true);
        expect(n.freq).toBeGreaterThan(0);
        expect(n.dur).toBeGreaterThan(0);
        expect(n.beat).toBeGreaterThanOrEqual(0);
      }
      for (const d of track.drums) {
        expect(d.beat).toBeGreaterThanOrEqual(0);
        expect(d.gain).toBeGreaterThan(0);
      }
    }
  });

  it('is registered under every stage id referenced by MUSIC_TRACKS', () => {
    expect(MUSIC_TRACKS.castro_street).toBe(CASTRO_STREET_TRACK);
    expect(MUSIC_TRACKS.sand_hill_road).toBe(SAND_HILL_ROAD_TRACK);
    expect(MUSIC_TRACKS.palo_alto).toBe(PALO_ALTO_TRACK);
  });
});
