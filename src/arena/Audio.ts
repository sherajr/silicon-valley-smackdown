/** Small, original synthesized score and responsive effects. Works entirely offline. */
export class ArenaAudio {
  ctx: AudioContext | null = null;
  muted = false;
  music = true;
  private nextBeat = 0;
  private beat = 0;
  private bus: GainNode | null = null;
  unlock() {
    try {
      if (!this.ctx) { this.ctx = new AudioContext(); this.bus = this.ctx.createGain(); this.bus.gain.value = this.muted ? 0 : 0.5; this.bus.connect(this.ctx.destination); }
      void this.ctx.resume().catch(() => {}); this.nextBeat = this.ctx.currentTime + 0.1;
    } catch { /* Audio unavailable: gameplay still works. */ }
  }
  setMute(value: boolean) { this.muted = value; if (this.ctx && this.bus) this.bus.gain.setTargetAtTime(value ? 0 : 0.5, this.ctx.currentTime, 0.02); }
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
  }
  update(active: boolean) {
    if (!this.ctx || this.ctx.state !== 'running') return;
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
