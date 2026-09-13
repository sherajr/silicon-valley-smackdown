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

interface SynthVoice {
  stop: (fadeUntil: number) => void;
}

/**
 * A configured bundled recording (e.g. a licensed track dropped into
 * /public/audio and pointed at here) that plays as the default gameplay
 * soundtrack instead of the synthesized fallback, without requiring the user
 * to pick a file. Left null when no such asset is bundled -- nothing is
 * fetched and nothing is requested, so a missing/unset asset never causes
 * failing network requests or a build-time dependency on a file that may not
 * exist yet.
 */
const BUNDLED_TRACK_URL: string | null = null;
const BUNDLED_TRACK_LABEL = 'Ox — Slàinte Mhath';

const DEFAULT_TRACK_LABEL = 'Original Score';

/**
 * Web Audio engine: a small scheduled synth sequencer for the original
 * fallback score, one-shot synthesized SFX, and (when supplied) playback of a
 * real recorded track -- either a configured bundled asset or a file the
 * player chooses locally. Fails safe (silently) if the AudioContext is
 * unavailable or blocked, so the game stays fully playable without sound.
 */
export class AudioManager {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private volumes: Volumes = { master: 0.8, music: 0.7, sfx: 0.85 };
  private intensity = 1;

  // Shared music transport state.
  private currentTrackId: string | null = null;
  /**
   * Identifies which playback *backend* is actually sounding -- the synthesized score for a given
   * scene track, or one specific recorded URL -- independent of the scene's track id. Choosing a
   * different custom file changes this even when the scene's track id does not, which is exactly
   * the transition playMusic()'s same-track guard used to swallow, leaving the old source playing.
   */
  private currentSourceKey: string | null = null;
  private stopped = true;
  private pausedForCombat = false;

  // Synth transport.
  private currentSynthTrack: MusicTrack | null = null;
  private activeSynthVoices = new Set<SynthVoice>();
  private loopTimer: ReturnType<typeof setTimeout> | null = null;
  private loopIterationStart = 0;
  private pausedElapsedInLoop: number | null = null;

  // Recorded-track transport (bundled asset or a locally chosen file).
  private customTrack: { url: string; label: string; revokeOnClear: boolean } | null = null;
  private recordedEl: HTMLAudioElement | null = null;
  private recordedGain: GainNode | null = null;
  private recordedSourceNode: MediaElementAudioSourceNode | null = null;
  private fileInput: HTMLInputElement | null = null;

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
    if (BUNDLED_TRACK_URL) this.tryLoadBundledTrack(BUNDLED_TRACK_URL, BUNDLED_TRACK_LABEL);
  }

  /** Call from a user gesture (click/keydown) handler to satisfy autoplay policies. Also retries a recorded track that was blocked until now. */
  resume(): void {
    if (!this.ctx) this.init();
    this.ctx?.resume().catch(() => undefined);
    if (this.recordedEl && !this.stopped && !this.pausedForCombat && this.recordedEl.paused) {
      this.recordedEl.play().catch(() => undefined);
    }
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

  /** Only ever affects the synthesized fallback's tempo (e.g. Crunch Mode). Never applied to a recorded track's playbackRate, which would pitch-shift it. */
  setIntensity(intensity: number): void {
    this.intensity = intensity;
  }

  // -------------------------------------------------------------------
  // Custom / bundled recorded track selection
  // -------------------------------------------------------------------

  private tryLoadBundledTrack(url: string, label: string): void {
    fetch(url, { method: 'HEAD' })
      .then((res) => {
        if (res.ok) this.customTrack = { url, label, revokeOnClear: false };
      })
      .catch(() => undefined); // asset not deployed at this URL -- fail once, silently, no retries
  }

  /** Opens a native file picker (audio/*) and, once a file is chosen, plays it as the current session's music. Session-only: never persisted (an object URL wouldn't survive a reload anyway). */
  promptChooseFile(): void {
    if (!this.fileInput) {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'audio/*';
      input.style.display = 'none';
      input.addEventListener('change', () => {
        const file = input.files?.[0];
        if (file) this.setCustomTrackFile(file);
        input.value = '';
      });
      document.body.appendChild(input);
      this.fileInput = input;
    }
    this.fileInput.click();
  }

  setCustomTrackFile(file: File): void {
    const retired = this.retireCustomTrack();
    const url = URL.createObjectURL(file);
    this.customTrack = { url, label: file.name, revokeOnClear: true };
    if (!this.stopped && this.currentTrackId) this.playMusic(this.currentTrackId);
    // Revoked only after playMusic() has torn the previous <audio> element off this URL --
    // revoking while an element still points at it can abort playback mid-teardown.
    retired?.();
  }

  /** Drops back to the original synthesized score. */
  clearCustomTrack(): void {
    const wasActive = !!this.customTrack;
    const retired = this.retireCustomTrack();
    if (wasActive && !this.stopped && this.currentTrackId) this.playMusic(this.currentTrackId);
    retired?.();
  }

  /**
   * Detaches the current custom track and returns a deferred revoke for its object URL (null when
   * there was nothing to revoke). The caller runs it *after* the transport has actually released
   * the old element, so a retired blob URL is never revoked while still attached to a live source.
   */
  private retireCustomTrack(): (() => void) | null {
    const previous = this.customTrack;
    this.customTrack = null;
    if (!previous?.revokeOnClear) return null;
    return () => URL.revokeObjectURL(previous.url);
  }

  hasCustomTrack(): boolean {
    return !!this.customTrack;
  }

  /** For Settings: never claims a synthesized substitute is the requested recording. */
  getSelectedTrackLabel(): string {
    return this.customTrack ? this.customTrack.label : DEFAULT_TRACK_LABEL;
  }

  // -------------------------------------------------------------------
  // Music transport
  // -------------------------------------------------------------------

  playMusic(trackId: string): void {
    if (!this.ctx || !this.musicGain) return;
    const desiredKey = this.sourceKeyFor(trackId);
    if (this.currentSourceKey === desiredKey && !this.stopped && !this.pausedForCombat) return;
    this.stopMusic();
    this.currentTrackId = trackId;
    this.currentSourceKey = desiredKey;
    this.stopped = false;

    if (this.customTrack) {
      this.startRecordedPlayback(this.customTrack.url);
      return;
    }
    const track = MUSIC_TRACKS[trackId];
    if (!track) {
      this.stopped = true;
      this.currentTrackId = null;
      this.currentSourceKey = null;
      return;
    }
    this.beginSynthLoop(track, this.ctx.currentTime + 0.05, 0);
  }

  /**
   * The recorded custom track (identified by its own URL) and the synthesized fallback
   * (identified by scene track id) are different playback backends, so a source-key change must
   * always force a real transition even when the scene's track id is unchanged.
   */
  private sourceKeyFor(trackId: string): string {
    return this.customTrack ? `custom:${this.customTrack.url}` : `synth:${trackId}`;
  }

  stopMusic(): void {
    this.stopped = true;
    this.pausedForCombat = false;
    this.currentTrackId = null;
    this.currentSourceKey = null;
    this.currentSynthTrack = null;
    this.pausedElapsedInLoop = null;
    this.cancelLoopTimer();
    this.stopAllSynthVoices(0.08);
    this.teardownRecorded(0.15);
  }

  /** Pauses the active transport in place (combat pause) without touching the shared AudioContext, so menu/UI SFX keep working while paused. */
  pauseMusic(): void {
    if (this.stopped || this.pausedForCombat) return;
    this.pausedForCombat = true;
    if (this.recordedEl) {
      this.recordedEl.pause();
    } else {
      this.pauseSynthLoop();
    }
  }

  /** Resumes exactly where pauseMusic() left off. */
  resumeMusic(): void {
    if (this.stopped || !this.pausedForCombat) return;
    this.pausedForCombat = false;
    if (this.recordedEl) {
      this.recordedEl.play().catch(() => undefined);
    } else {
      this.resumeSynthLoop();
    }
  }

  playOneShotTrack(trackId: string): void {
    if (!this.ctx || !this.musicGain) return;
    const track = MUSIC_TRACKS[trackId];
    if (!track) return;
    const startTime = this.ctx.currentTime + 0.02;
    const beatDur = 60 / track.bpm;
    for (const n of track.lead) this.scheduleMusicTone(startTime + n.beat * beatDur, n.freq, n.dur * beatDur, n.wave, n.gain);
    for (const n of track.bass) this.scheduleMusicTone(startTime + n.beat * beatDur, n.freq, n.dur * beatDur, n.wave, n.gain);
    for (const d of track.drums) this.scheduleMusicDrum(startTime + d.beat * beatDur, d);
  }

  // -------------------------------------------------------------------
  // Recorded-track playback (custom file or bundled asset)
  // -------------------------------------------------------------------

  private startRecordedPlayback(url: string): void {
    if (!this.ctx || !this.musicGain) return;
    const el = new Audio(url);
    el.loop = true;
    el.preload = 'auto';
    el.volume = 1;
    const gain = this.ctx.createGain();
    gain.gain.value = 0;
    gain.connect(this.musicGain);
    try {
      const node = this.ctx.createMediaElementSource(el);
      node.connect(gain);
      this.recordedSourceNode = node;
    } catch {
      // Some environments restrict routing a media element into the Web Audio graph;
      // fall back to the element's own volume so playback still works, just outside
      // the Master/Music gain nodes, rather than staying silent.
      gain.disconnect();
      el.volume = Math.max(0, Math.min(1, this.volumes.master * this.volumes.music));
    }
    this.recordedEl = el;
    this.recordedGain = gain;
    el
      .play()
      .then(() => gain.gain.linearRampToValueAtTime(1, this.ctx!.currentTime + 0.35))
      .catch(() => undefined); // blocked pending a user gesture; resume() retries
    el.addEventListener(
      'error',
      () => {
        // Missing/broken file: fail safe and stop rather than looping failed requests.
        this.stopMusic();
      },
      { once: true },
    );
  }

  private teardownRecorded(fadeSec: number): void {
    if (!this.recordedEl) return;
    const el = this.recordedEl;
    const gain = this.recordedGain;
    const node = this.recordedSourceNode;
    this.recordedEl = null;
    this.recordedGain = null;
    this.recordedSourceNode = null;
    if (gain && this.ctx) {
      const now = this.ctx.currentTime;
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(gain.gain.value, now);
      gain.gain.linearRampToValueAtTime(0, now + fadeSec);
    }
    setTimeout(
      () => {
        el.pause();
        el.removeAttribute('src');
        el.load();
        node?.disconnect();
        gain?.disconnect();
      },
      Math.max(0, fadeSec * 1000) + 30,
    );
  }

  // -------------------------------------------------------------------
  // Synthesized fallback transport
  // -------------------------------------------------------------------

  /** Schedules one loop iteration starting at `startTime`, skipping any notes that would fall before `skipBeforeSec` into the loop (used to resume mid-cycle instead of restarting from the top). Reschedules itself for the next iteration unless stopped. */
  private beginSynthLoop(track: MusicTrack, startTime: number, skipBeforeSec: number): void {
    if (!this.ctx || !this.musicGain) return;
    this.currentSynthTrack = track;
    const beatDur = 60 / (track.bpm * this.intensity);
    const loopDur = beatDur * track.lengthBeats;
    const base = startTime - skipBeforeSec;
    this.loopIterationStart = base;

    const scheduleTone = (beat: number, freq: number, dur: number, wave: OscillatorType, gain: number) => {
      const t = base + beat * beatDur;
      if (t < startTime - 0.0005) return; // already elapsed this cycle -- skip rather than clamp into an audible burst
      this.scheduleMusicTone(t, freq, dur * beatDur, wave, gain);
    };
    for (const n of track.lead) scheduleTone(n.beat, n.freq, n.dur, n.wave, n.gain);
    for (const n of track.bass) scheduleTone(n.beat, n.freq, n.dur, n.wave, n.gain);
    for (const d of track.drums) {
      const t = base + d.beat * beatDur;
      if (t < startTime - 0.0005) continue;
      this.scheduleMusicDrum(t, d);
    }

    if (this.stopped) return;
    const nextStart = base + loopDur;
    const delaySec = Math.max(0.05, loopDur - skipBeforeSec - 0.12);
    this.armLoopTimer(() => {
      if (!this.ctx || this.stopped) return;
      // Guard against a late (throttled/backgrounded) timer firing after `nextStart` has
      // already passed: reschedule relative to the live clock instead of the stale target,
      // so a delayed callback never dumps a burst of already-past notes all at once.
      const safeStart = Math.max(nextStart, this.ctx.currentTime + 0.02);
      this.beginSynthLoop(track, safeStart, 0);
    }, delaySec);
  }

  private pauseSynthLoop(): void {
    if (!this.ctx || !this.currentSynthTrack) return;
    const beatDur = 60 / (this.currentSynthTrack.bpm * this.intensity);
    const loopDur = beatDur * this.currentSynthTrack.lengthBeats;
    const raw = (this.ctx.currentTime - this.loopIterationStart) % loopDur;
    this.pausedElapsedInLoop = ((raw % loopDur) + loopDur) % loopDur;
    this.cancelLoopTimer();
    this.stopAllSynthVoices(0.05);
  }

  private resumeSynthLoop(): void {
    if (!this.ctx || !this.currentSynthTrack || this.pausedElapsedInLoop == null) return;
    const track = this.currentSynthTrack;
    const skip = this.pausedElapsedInLoop;
    this.pausedElapsedInLoop = null;
    this.beginSynthLoop(track, this.ctx.currentTime + 0.05, skip);
  }

  private armLoopTimer(fn: () => void, delaySec: number): void {
    this.cancelLoopTimer();
    this.loopTimer = setTimeout(fn, Math.max(0, delaySec * 1000));
  }

  private cancelLoopTimer(): void {
    if (this.loopTimer) {
      clearTimeout(this.loopTimer);
      this.loopTimer = null;
    }
  }

  /** Schedules one music note, tracked so pauseMusic()/stopMusic()/a track switch can fade and stop it instead of only cancelling future scheduling. */
  private scheduleMusicTone(time: number, freq: number, dur: number, wave: OscillatorType, gain: number): void {
    if (!this.ctx || !this.musicGain) return;
    const osc = this.ctx.createOscillator();
    osc.type = wave;
    osc.frequency.setValueAtTime(freq, time);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, time);
    g.gain.linearRampToValueAtTime(gain, time + 0.012);
    g.gain.linearRampToValueAtTime(0, time + Math.max(0.03, dur * 0.92));
    osc.connect(g);
    g.connect(this.musicGain);
    osc.start(time);
    osc.stop(time + dur + 0.05);
    const voice: SynthVoice = {
      stop: (fadeUntil) => {
        try {
          const now = this.ctx!.currentTime;
          g.gain.cancelScheduledValues(now);
          g.gain.setValueAtTime(g.gain.value, now);
          g.gain.linearRampToValueAtTime(0, fadeUntil);
          osc.stop(fadeUntil + 0.02);
        } catch {
          // already stopped naturally
        }
      },
    };
    this.activeSynthVoices.add(voice);
    osc.onended = () => this.activeSynthVoices.delete(voice);
  }

  private scheduleMusicDrum(time: number, d: DrumHit): void {
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
      const voice: SynthVoice = {
        stop: (fadeUntil) => {
          try {
            const now = this.ctx!.currentTime;
            g.gain.cancelScheduledValues(now);
            g.gain.setValueAtTime(g.gain.value, now);
            g.gain.linearRampToValueAtTime(0, fadeUntil);
            osc.stop(fadeUntil + 0.02);
          } catch {
            // already stopped naturally
          }
        },
      };
      this.activeSynthVoices.add(voice);
      osc.onended = () => this.activeSynthVoices.delete(voice);
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
      const voice: SynthVoice = {
        stop: (fadeUntil) => {
          try {
            const now = this.ctx!.currentTime;
            g.gain.cancelScheduledValues(now);
            g.gain.setValueAtTime(g.gain.value, now);
            g.gain.linearRampToValueAtTime(0, fadeUntil);
            src.stop(fadeUntil + 0.02);
          } catch {
            // already stopped naturally
          }
        },
      };
      this.activeSynthVoices.add(voice);
      src.onended = () => this.activeSynthVoices.delete(voice);
    }
  }

  private stopAllSynthVoices(fadeSec: number): void {
    if (!this.ctx) {
      this.activeSynthVoices.clear();
      return;
    }
    const fadeUntil = this.ctx.currentTime + fadeSec;
    for (const v of this.activeSynthVoices) v.stop(fadeUntil);
    this.activeSynthVoices.clear();
  }

  // -------------------------------------------------------------------
  // One-shot SFX (untracked -- short enough to always fire-and-forget)
  // -------------------------------------------------------------------

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
