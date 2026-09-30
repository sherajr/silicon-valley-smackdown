import { noInput } from './controls';
import type { Controls } from './controls';

const MAPS = [
  { left: ['KeyA'], right: ['KeyD'], up: ['KeyW'], down: ['KeyS'], jump: ['KeyW', 'Space'], attack: ['KeyV'], special: ['KeyB'], shield: ['KeyN'], grab: ['KeyM'] },
  { left: ['ArrowLeft'], right: ['ArrowRight'], up: ['ArrowUp'], down: ['ArrowDown'], jump: ['ArrowUp'], attack: ['KeyJ', 'Numpad4', 'Digit4'], special: ['KeyK', 'Numpad5', 'Digit5'], shield: ['KeyL', 'Numpad6', 'Digit6'], grab: ['Semicolon', 'NumpadAdd', 'Equal'] },
];
const handled = new Set([...MAPS.flatMap(m => Object.values(m).flat()), 'Period']);
export class ArenaInput {
  held = new Set<string>();
  pressed = new Set<string>();
  private padPrev = new Map<number, boolean[]>();
  onPause = () => {};
  onFullscreen = () => {};
  onMute = () => {};
  /** Training: advance one simulation frame while frame-step mode is on. */
  onStep = () => {};
  active = false;
  constructor() {
    window.addEventListener('keydown', e => {
      if (e.code === 'Escape' && !e.repeat) { this.onPause(); return; }
      if (e.code === 'KeyF' && !e.repeat && this.active) this.onFullscreen();
      if (e.code === 'KeyO' && !e.repeat && this.active) this.onMute();
      if (e.code === 'Period' && !e.repeat && this.active) this.onStep();
      if (!this.active || e.target instanceof HTMLSelectElement || e.target instanceof HTMLInputElement) return;
      if (handled.has(e.code)) { e.preventDefault(); if (!this.held.has(e.code)) this.pressed.add(e.code); this.held.add(e.code); }
    });
    window.addEventListener('keyup', e => this.held.delete(e.code));
    window.addEventListener('blur', () => this.clear());
  }
  clear() { this.held.clear(); this.pressed.clear(); this.padPrev.clear(); }
  /**
   * Reads one simulation tick of input. Buttons are press edges (the simulation also detects edges itself, so a held
   * button never repeats). Directions and shield count a key that was pressed and released between two ticks as held
   * for this tick, so a quick tap of W in a W+B chord cannot be lost to a slow frame.
   */
  sample(): [Controls, Controls] {
    const pads = typeof navigator.getGamepads === 'function' ? Array.from(navigator.getGamepads()).filter((p): p is Gamepad => !!p) : [];
    const commands = MAPS.map((m, i) => {
      const c = noInput();
      const held = (a: string[]) => a.some(k => this.held.has(k) || this.pressed.has(k)), pressed = (a: string[]) => a.some(k => this.pressed.has(k));
      c.x = Number(held(m.right)) - Number(held(m.left)); c.up = held(m.up); c.down = held(m.down);
      c.jump = pressed(m.jump); c.attack = pressed(m.attack); c.special = pressed(m.special); c.grab = pressed(m.grab); c.shield = held(m.shield);
      const pad = pads[i];
      if (pad) {
        const prev = this.padPrev.get(pad.index) ?? [], on = (b: number) => !!pad.buttons[b]?.pressed, edge = (b: number) => on(b) && !prev[b];
        const axis = pad.axes[0] ?? 0; if (Math.abs(axis) > 0.25) c.x = Math.sign(axis); if (on(14)) c.x = -1; if (on(15)) c.x = 1;
        c.up ||= on(12) || (pad.axes[1] ?? 0) < -0.5; c.down ||= on(13) || (pad.axes[1] ?? 0) > 0.5;
        c.jump ||= edge(0) || edge(12); c.attack ||= edge(2); c.special ||= edge(1); c.grab ||= edge(3);
        c.shield ||= on(4) || on(6) || on(7);
        if (edge(9)) this.onPause();
        this.padPrev.set(pad.index, pad.buttons.map(b => b.pressed));
      }
      return c;
    }) as [Controls, Controls];
    this.pressed.clear(); return commands;
  }
}
