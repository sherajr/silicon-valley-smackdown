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
    const pads = this.gamepads();
    const commands = MAPS.map((map, i) => this.readMap(map, pads[i])) as [Controls, Controls];
    this.pressed.clear();
    return commands;
  }

  /**
   * Online play: this browser is one fighter. Player 1 keys and the first connected gamepad are used.
   * Player 2 keys and a second pad are ignored so two machines do not share a keyboard mapping.
   */
  sampleLocal(): Controls {
    const controls = this.readMap(MAPS[0], this.gamepads()[0]);
    this.pressed.clear();
    return controls;
  }

  private gamepads(): Gamepad[] {
    return typeof navigator.getGamepads === 'function' ? Array.from(navigator.getGamepads()).filter((pad): pad is Gamepad => !!pad) : [];
  }

  private readMap(map: typeof MAPS[number], pad: Gamepad | undefined): Controls {
    const controls = noInput();
    const held = (codes: string[]) => codes.some(code => this.held.has(code) || this.pressed.has(code));
    const pressed = (codes: string[]) => codes.some(code => this.pressed.has(code));
    controls.x = Number(held(map.right)) - Number(held(map.left));
    controls.up = held(map.up); controls.down = held(map.down);
    controls.jump = pressed(map.jump); controls.attack = pressed(map.attack); controls.special = pressed(map.special);
    controls.grab = pressed(map.grab); controls.shield = held(map.shield);
    if (pad) {
      const prev = this.padPrev.get(pad.index) ?? [];
      const on = (button: number) => !!pad.buttons[button]?.pressed;
      const edge = (button: number) => on(button) && !prev[button];
      const axis = pad.axes[0] ?? 0;
      if (Math.abs(axis) > 0.25) controls.x = Math.sign(axis);
      if (on(14)) controls.x = -1;
      if (on(15)) controls.x = 1;
      controls.up ||= on(12) || (pad.axes[1] ?? 0) < -0.5;
      controls.down ||= on(13) || (pad.axes[1] ?? 0) > 0.5;
      controls.jump ||= edge(0) || edge(12);
      controls.attack ||= edge(2);
      controls.special ||= edge(1);
      controls.grab ||= edge(3);
      controls.shield ||= on(4) || on(6) || on(7);
      if (edge(9)) this.onPause();
      this.padPrev.set(pad.index, pad.buttons.map(button => button.pressed));
    }
    return controls;
  }
}
