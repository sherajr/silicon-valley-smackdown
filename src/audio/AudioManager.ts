import { MUSIC_TRACKS, type MusicTrack, type DrumHit } from './tracks';

export type SfxId =
  | 'select'
  | 'confirm'
  | 'cancel'
  | 'hitLight'
  | 'hitHeavy'
  | 'blocked'
  | 'throw'
  | 'projectile'
  | 'pickup'
  | 'super'
  | 'ko'
  | 'guardBreak'
  | 'pause'
  | 'roundStart'
  | 'bossEntrance';

interface Volumes {
  master: number;
  music: number;
  sfx: number;
}

/**
 * Web Audio synthesis engine: a small scheduled chiptune sequencer for music
 * plus one-shot synthesized SFX. Fails safe (silently) if the AudioContext is
 * unavailable or blocked, so the game stays fully playable without sound.
 */
export class AudioManager {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private volumes: Volumes = { master: 0.8, music: 0.7, sfx: 0.85 };
  private currentTrackId: string | null = null;
  private loopTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = true;
  private intensity = 1;

  init(): void {
    if (this.ctx) return;
    try {
      const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      this.masterGain = this.ctx.createGain();
      this.musicGain = this.ctx.createGain();
      this.sfxGain = this.ctx.createGain();
      this.musicGain.connect(this.masterGain);
      this.sfxGain.connect(this.masterGain);
      this.masterGain.connect(this.ctx.destination);
      this.applyVolumes();
      this.noiseBuffer = this.buildNoiseBuffer();
    } catch {
      this.ctx = null;
    }
  }

  /** Call from a user gesture (click/keydown) handler to satisfy autoplay policies. */
  resume(): void {
    if (!this.ctx) this.init();
    this.ctx?.resume().catch(() => undefined);
  }

  setVolumes(v: Partial<Volumes>): void {
    this.volumes = { ...this.volumes, ...v };
    this.applyVolumes();
  }

  getVolumes(): Volumes {
    return { ...this.volumes };
  }

  private applyVolumes(): void {
    if (!this.ctx || !this.masterGain || !this.musicGain || !this.sfxGain) return;
    this.masterGain.gain.value = this.volumes.master;
    this.musicGain.gain.value = this.volumes.music;
    this.sfxGain.gain.value = this.volumes.sfx;
  }

  private buildNoiseBuffer(): AudioBuffer {
    const ctx = this.ctx!;
    const buffer = ctx.createBuffer(1, ctx.sampleRate * 1, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  setIntensity(intensity: number): void {
    this.intensity = intensity;
  }

  playMusic(trackId: string): void {
    if (!this.ctx || !this.musicGain) return;
    if (this.currentTrackId === trackId && !this.stopped) return;
    this.stopMusic();
    const track = MUSIC_TRACKS[trackId];
    if (!track) return;
    this.currentTrackId = trackId;
    this.stopped = false;
    this.scheduleLoop(track, this.ctx.currentTime + 0.05);
  }

  stopMusic(): void {
    this.stopped = true;
    this.currentTrackId = null;
    if (this.loopTimer) {
      clearTimeout(this.loopTimer);
      this.loopTimer = null;
    }
  }

  playOneShotTrack(trackId: string): void {
    if (!this.ctx || !this.musicGain) return;
    const track = MUSIC_TRACKS[trackId];
    if (!track) return;
    this.scheduleLoop(track, this.ctx.currentTime + 0.02, true);
  }

  private scheduleLoop(track: MusicTrack, startTime: number, once = false): void {
    if (!this.ctx || !this.musicGain) return;
    const beatDur = 60 / (track.bpm * (once ? 1 : this.intensity));
    const loopDur = beatDur * track.lengthBeats;
    for (const n of track.lead) this.scheduleTone(this.musicGain, startTime + n.beat * beatDur, n.freq, n.dur * beatDur, n.wave, n.gain);
    for (const n of track.bass) this.scheduleTone(this.musicGain, startTime + n.beat * beatDur, n.freq, n.dur * beatDur, n.wave, n.gain);
    for (const d of track.drums) this.scheduleDrum(startTime + d.beat * beatDur, d);
    if (once || this.stopped) return;
    const delay = Math.max(50, (loopDur - 0.12) * 1000);
    this.loopTimer = setTimeout(() => this.scheduleLoop(track, startTime + loopDur), delay);
  }

  private scheduleTone(dest: GainNode, time: number, freq: number, dur: number, wave: OscillatorType, gain: number): void {
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    osc.type = wave;
    osc.frequency.setValueAtTime(freq, time);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, time);
    g.gain.linearRampToValueAtTime(gain, time + 0.012);
    g.gain.linearRampToValueAtTime(0, time + Math.max(0.03, dur * 0.92));
    osc.connect(g);
    g.connect(dest);
    osc.start(time);
    osc.stop(time + dur + 0.05);
  }

  private scheduleDrum(time: number, d: DrumHit): void {
    if (!this.ctx || !this.musicGain || !this.noiseBuffer) return;
    if (d.type === 'kick') {
      const osc = this.ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(140, time);
      osc.frequency.exponentialRampToValueAtTime(45, time + 0.12);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(d.gain, time);
      g.gain.exponentialRampToValueAtTime(0.001, time + 0.15);
      osc.connect(g);
      g.connect(this.musicGain);
      osc.start(time);
      osc.stop(time + 0.2);
    } else {
      const src = this.ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      const filter = this.ctx.createBiquadFilter();
      filter.type = d.type === 'hat' ? 'highpass' : 'bandpass';
      filter.frequency.value = d.type === 'hat' ? 7000 : 1800;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(d.gain, time);
      g.gain.exponentialRampToValueAtTime(0.001, time + (d.type === 'hat' ? 0.05 : 0.12));
      src.connect(filter);
      filter.connect(g);
      g.connect(this.musicGain);
      src.start(time);
      src.stop(time + 0.15);
    }
  }

  playSfx(id: SfxId): void {
    if (!this.ctx || !this.sfxGain) return;
    const t = this.ctx.currentTime;
    switch (id) {
      case 'select':
        this.scheduleTone(this.sfxGain, t, 660, 0.06, 'square', 0.2);
        break;
      case 'confirm':
        this.scheduleTone(this.sfxGain, t, 520, 0.05, 'square', 0.22);
        this.scheduleTone(this.sfxGain, t + 0.06, 780, 0.09, 'square', 0.22);
        break;
      case 'cancel':
        this.scheduleTone(this.sfxGain, t, 300, 0.08, 'square', 0.18);
        break;
      case 'hitLight':
        this.scheduleTone(this.sfxGain, t, 220, 0.05, 'square', 0.22);
        this.scheduleNoise(t, 0.04, 2200, 0.2);
        break;
      case 'hitHeavy':
        this.scheduleTone(this.sfxGain, t, 130, 0.09, 'sawtooth', 0.28);
        this.scheduleNoise(t, 0.09, 1200, 0.28);
        break;
      case 'blocked':
        this.scheduleTone(this.sfxGain, t, 380, 0.05, 'triangle', 0.18);
        this.scheduleNoise(t, 0.05, 4000, 0.14);
        break;
      case 'throw':
        this.scheduleTone(this.sfxGain, t, 200, 0.14, 'sawtooth', 0.24);
        this.scheduleTone(this.sfxGain, t + 0.1, 90, 0.12, 'sine', 0.3);
        break;
      case 'projectile':
        this.scheduleSweep(t, 900, 500, 0.12, 0.18);
        break;
      case 'pickup':
        this.scheduleSweep(t, 500, 1100, 0.14, 0.2);
        break;
      case 'super':
        this.scheduleSweep(t, 200, 1400, 0.5, 0.3);
        this.scheduleNoise(t + 0.4, 0.2, 900, 0.3);
        break;
      case 'ko':
        this.scheduleSweep(t, 500, 60, 0.6, 0.32);
        this.scheduleNoise(t, 0.3, 700, 0.3);
        break;
      case 'guardBreak':
        this.scheduleTone(this.sfxGain, t, 620, 0.05, 'square', 0.22);
        this.scheduleTone(this.sfxGain, t + 0.05, 480, 0.05, 'square', 0.22);
        this.scheduleTone(this.sfxGain, t + 0.1, 340, 0.12, 'square', 0.22);
        break;
      case 'pause':
        this.scheduleTone(this.sfxGain, t, 440, 0.04, 'square', 0.16);
        break;
      case 'roundStart':
        this.scheduleTone(this.sfxGain, t, 440, 0.1, 'square', 0.24);
        this.scheduleTone(this.sfxGain, t + 0.15, 660, 0.16, 'square', 0.26);
        break;
      case 'bossEntrance':
        this.scheduleSweep(t, 80, 340, 0.8, 0.3);
        this.scheduleNoise(t + 0.6, 0.3, 300, 0.3);
        break;
    }
  }

  private scheduleNoise(time: number, dur: number, filterFreq: number, gain: number): void {
    if (!this.ctx || !this.sfxGain || !this.noiseBuffer) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = filterFreq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, time);
    g.gain.exponentialRampToValueAtTime(0.001, time + dur);
    src.connect(filter);
    filter.connect(g);
    g.connect(this.sfxGain);
    src.start(time);
    src.stop(time + dur + 0.02);
  }

  private scheduleSweep(time: number, fromFreq: number, toFreq: number, dur: number, gain: number): void {
    if (!this.ctx || !this.sfxGain) return;
    const osc = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(fromFreq, time);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, toFreq), time + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, time);
    g.gain.exponentialRampToValueAtTime(0.001, time + dur);
    osc.connect(g);
    g.connect(this.sfxGain);
    osc.start(time);
    osc.stop(time + dur + 0.02);
  }
}

export const audioManager = new AudioManager();
