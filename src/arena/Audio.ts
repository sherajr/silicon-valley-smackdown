import celticArcadeUrl from '../audio/tracks/celtic_arcade.mp3';

/** Bundled "Celtic Arcade Run" soundtrack, with a small synthesized score as fallback and responsive effects. Works entirely offline. */
export class ArenaAudio {
  ctx: AudioContext | null = null;
  muted = false;
  music = true;
  private nextBeat = 0;
  private beat = 0;
  private bus: GainNode | null = null;
  private track: HTMLAudioElement | null = null;
  private trackFailed = false;
  private trackPlaying = false;
  private ensureTrack() {
    if (this.track || this.trackFailed) return;
    try {
      const el = new Audio(celticArcadeUrl);
      el.loop = true; el.preload = 'auto'; el.volume = 0.6;
      el.addEventListener('error', () => { this.trackFailed = true; this.trackPlaying = false; }, { once: true });
      this.track = el;
    } catch { this.trackFailed = true; }
  }
  unlock() {
    try {
      if (!this.ctx) { this.ctx = new AudioContext(); this.bus = this.ctx.createGain(); this.bus.gain.value = this.muted ? 0 : 0.5; this.bus.connect(this.ctx.destination); }
      void this.ctx.resume().catch(() => {}); this.ensureTrack(); this.nextBeat = this.ctx.currentTime + 0.1;
    } catch { /* Audio unavailable: gameplay still works. */ }
  }
  setMute(value: boolean) { this.muted = value; if (this.track) this.track.muted = value; if (this.ctx && this.bus) this.bus.gain.setTargetAtTime(value ? 0 : 0.5, this.ctx.currentTime, 0.02); }
  private tone(freq: number, length: number, volume: number, type: OscillatorType, at?: number, end?: number) {
    if (!this.ctx || !this.bus) return;
    const t = at ?? this.ctx.currentTime, o = this.ctx.createOscillator(), gain = this.ctx.createGain(); o.type = type;
    o.frequency.setValueAtTime(freq, t); if (end) o.frequency.exponentialRampToValueAtTime(end, t + length);
    gain.gain.setValueAtTime(0, t); gain.gain.linearRampToValueAtTime(volume, t + 0.008); gain.gain.exponentialRampToValueAtTime(0.001, t + length);
    o.connect(gain); gain.connect(this.bus); o.start(t); o.stop(t + length + 0.02);
    o.onended = () => { o.disconnect(); gain.disconnect(); };
  }
  effect(type: string) {
    if (this.muted) return;
    if (type === 'hit') { this.tone(150, 0.12, 0.22, 'triangle', undefined, 45); this.tone(900, 0.065, 0.06, 'sawtooth', undefined, 70); }
    if (type === 'block') this.tone(440, 0.14, 0.10, 'sine', undefined, 750);
    if (type === 'shot') this.tone(650, 0.12, 0.065, 'sawtooth', undefined, 250);
    if (type === 'jump' || type === 'recovery') this.tone(150, 0.17, 0.07, 'sine', undefined, 420);
    if (type === 'ko') { this.tone(90, 0.70, 0.22, 'sawtooth', undefined, 25); this.tone(700, 0.5, 0.14, 'triangle', undefined, 140); }
    if (type === 'pickup') { this.tone(523, 0.12, 0.13, 'sine'); this.tone(784, 0.25, 0.12, 'sine', (this.ctx?.currentTime ?? 0) + 0.1); }
    if (type === 'finish') for (let i = 0; i < 4; i++) this.tone([262, 330, 392, 523][i], 0.6, 0.11, 'triangle', (this.ctx?.currentTime ?? 0) + i * 0.12);
    // Grab, tech, throw and move-specific cues: short synthesized blips, no assets.
    const now = this.ctx?.currentTime ?? 0;
    if (type === 'catch') { this.tone(210, 0.09, 0.16, 'square', undefined, 90); this.tone(1200, 0.05, 0.05, 'triangle', undefined, 600); }
    if (type === 'tech') { this.tone(880, 0.10, 0.12, 'sine', undefined, 1320); this.tone(1320, 0.14, 0.08, 'triangle', now + 0.06); }
    if (type === 'pummel') this.tone(180, 0.07, 0.12, 'triangle', undefined, 80);
    if (type === 'throwBreak') { this.tone(300, 0.12, 0.10, 'square', undefined, 150); this.tone(300, 0.12, 0.10, 'square', now + 0.05, 150); }
    if (type === 'counter') { this.tone(1046, 0.25, 0.12, 'sine'); this.tone(523, 0.3, 0.12, 'triangle', undefined, 1046); }
    if (type === 'armor') this.tone(120, 0.10, 0.16, 'square', undefined, 60);
    if (type === 'impact') { this.tone(70, 0.4, 0.26, 'sawtooth', undefined, 28); this.tone(200, 0.18, 0.10, 'triangle', undefined, 50); }
    if (type === 'combo') this.tone(740, 0.06, 0.06, 'sine', undefined, 988);
    if (type === 'fizzle') this.tone(140, 0.08, 0.06, 'sawtooth', undefined, 100);
    if (type === 'bounce') this.tone(420, 0.08, 0.06, 'triangle', undefined, 160);
    if (type === 'shotBreak') this.tone(260, 0.08, 0.06, 'triangle', undefined, 120);
    if (type === 'roll') this.tone(240, 0.12, 0.05, 'sine', undefined, 160);
  }
  update(active: boolean) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const el = this.track;
    if (el && !this.trackFailed) {
      const want = this.music && !this.muted && active;
      if (want && el.paused) el.play().then(() => { this.trackPlaying = true; }).catch(() => { /* blocked until a gesture; retried next frame */ });
      else if (!want && !el.paused) { el.pause(); this.trackPlaying = false; }
      if (want) { this.nextBeat = this.ctx.currentTime + 0.1; return; }
    }
    if (!this.music || this.muted || !active) { this.nextBeat = this.ctx.currentTime + 0.1; return; }
    if (this.nextBeat < this.ctx.currentTime - 0.3) this.nextBeat = this.ctx.currentTime;
    while (this.nextBeat < this.ctx.currentTime + 0.10) {
      const root = [55, 65.41, 49, 73.42][Math.floor(this.beat / 16) % 4];
      if (this.beat % 2 === 0) this.tone(root * (this.beat % 8 === 6 ? 2 : 1), 0.19, 0.085, 'triangle', this.nextBeat);
      if (this.beat % 4 === 0) this.tone(120, 0.13, 0.12, 'sine', this.nextBeat, 36);
      if (this.beat % 4 === 2) this.tone(190, 0.08, 0.032, 'triangle', this.nextBeat, 75);
      if (this.beat % 2 === 1) this.tone(5400, 0.025, 0.010, 'square', this.nextBeat, 4000);
      const intervals = [4, 6, 8, 6, 4, 3, 4, 6];
      this.tone(root * intervals[this.beat % 8], 0.15, 0.027, 'sine', this.nextBeat);
      this.nextBeat += 60 / 112 / 2; this.beat++;
    }
  }
}
