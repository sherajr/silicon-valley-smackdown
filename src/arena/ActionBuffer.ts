/**
 * Per-fighter input buffer. A fresh press of attack, special, grab or jump becomes a request that stays valid for
 * `BUFFER_FRAMES` gameplay frames, so a press made just before a fighter becomes able to act still executes.
 *
 * - Requests are captured on every tick, including hitstop ticks, so no press is ever lost to a freeze.
 * - Requests do not age while the simulation is frozen (hitstop), but do age through stun and move recovery.
 * - Fresh presses are detected here (false -> true between ticks): a button held down never repeats.
 * - A request remembers the direction held when it was pressed, and the tick it was pressed on.
 * All state is plain data so it serialises with the fighter.
 */
import type { Controls } from './controls';

export type Button = 'attack' | 'special' | 'grab' | 'jump';
export const BUTTONS: readonly Button[] = ['attack', 'special', 'grab', 'jump'];
/** How many frames early a press may arrive and still execute. */
export const BUFFER_FRAMES = 6;

export interface Request { id: number; button: Button; age: number; tick: number; x: number; up: boolean; down: boolean }
export interface InputState { prev: Record<Button, boolean>; requests: Request[]; serial: number }

export const newInputState = (): InputState => ({ prev: { attack: false, special: false, grab: false, jump: false }, requests: [], serial: 0 });

/**
 * Feeds one tick of controls. `frozen`: simulation is in hitstop, so existing requests keep their age.
 * `capture`: false while the match is not live (countdown): button levels are still tracked so a button held
 * through the countdown is not a fresh press at GO, but no request is created.
 */
export function pushInput(s: InputState, c: Controls, tick: number, frozen: boolean, capture = true): void {
  if (!frozen) {
    for (const r of s.requests) r.age++;
    if (s.requests.some(r => r.age > BUFFER_FRAMES)) s.requests = s.requests.filter(r => r.age <= BUFFER_FRAMES);
  }
  for (const b of BUTTONS) {
    const down = !!c[b];
    if (capture && down && !s.prev[b]) s.requests.push({ id: ++s.serial, button: b, age: 0, tick, x: c.x, up: c.up, down: c.down });
    s.prev[b] = down;
  }
}

/** Newest live request for a button. */
export function latest(s: InputState, button: Button): Request | undefined {
  let found: Request | undefined;
  for (const r of s.requests) if (r.button === button && (!found || r.id > found.id)) found = r;
  return found;
}

/** Was a fresh press of this button made at or after `tick`? Used for grab escapes, which must be a new press. */
export function pressedSince(s: InputState, button: Button, tick: number): boolean {
  return s.requests.some(r => r.button === button && r.tick >= tick);
}

/** Removes a request, every older request of the same button, and other buttons pressed on the same tick (a chord). */
export function consume(s: InputState, r: Request): void {
  s.requests = s.requests.filter(q => q.id !== r.id && !(q.button === r.button && q.id < r.id) && q.tick !== r.tick);
}

/** Removes every pending request of one button (used when an action is refused outright, like an empty recovery). */
export function discard(s: InputState, button: Button): void {
  s.requests = s.requests.filter(q => q.button !== button);
}

/** Forgets every pending request and press edge. Called on launch, pause, countdown, KO and respawn. */
export function clearInputs(s: InputState, held?: Controls): void {
  s.requests = [];
  for (const b of BUTTONS) s.prev[b] = held ? !!held[b] : false;
}
