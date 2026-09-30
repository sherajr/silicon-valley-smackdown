import { describe, it, expect } from 'vitest';
import { BUFFER_FRAMES, clearInputs, consume, discard, latest, newInputState, pressedSince, pushInput } from './ActionBuffer';
import { noInput } from './controls';
import type { Controls } from './controls';

const c = (extra: Partial<Controls> = {}): Controls => ({ ...noInput(), ...extra });
const feed = (s: ReturnType<typeof newInputState>, ticks: number, extra: Partial<Controls> = {}, start = 0, frozen = false) => { for (let i = 0; i < ticks; i++) pushInput(s, c(extra), start + i, frozen); };

describe('ActionBuffer', () => {
  it('a fresh press becomes one request with the direction held at that moment', () => {
    const s = newInputState();
    pushInput(s, c({ attack: true, x: -1, up: true }), 5, false);
    expect(s.requests).toHaveLength(1);
    expect(s.requests[0]).toMatchObject({ button: 'attack', age: 0, tick: 5, x: -1, up: true, down: false });
  });
  it('a held button is a single press, however long it is held', () => {
    const s = newInputState();
    feed(s, 30, { attack: true });
    expect(s.serial).toBe(1);                                       // exactly one request was ever created
  });
  it('releasing and pressing again is a new request', () => {
    const s = newInputState();
    pushInput(s, c({ grab: true }), 0, false); pushInput(s, c(), 1, false); pushInput(s, c({ grab: true }), 2, false);
    expect(s.requests.filter(r => r.button === 'grab')).toHaveLength(2);
  });
  it('requests are valid for exactly the buffer window and then expire', () => {
    const s = newInputState();
    pushInput(s, c({ jump: true }), 0, false);
    for (let i = 1; i <= BUFFER_FRAMES; i++) { pushInput(s, c(), i, false); expect(latest(s, 'jump'), `age ${i}`).toBeDefined(); }
    pushInput(s, c(), BUFFER_FRAMES + 1, false);
    expect(latest(s, 'jump')).toBeUndefined();
  });
  it('frozen ticks capture new presses but never age anything', () => {
    const s = newInputState();
    pushInput(s, c({ attack: true }), 0, false);
    feed(s, 20, {}, 1, true);                                       // a long hitstop
    expect(latest(s, 'attack')!.age).toBe(0);
    pushInput(s, c({ special: true }), 21, true);                   // pressed during the freeze
    expect(latest(s, 'special')).toMatchObject({ age: 0, tick: 21 });
    feed(s, BUFFER_FRAMES, {}, 22, false);
    expect(latest(s, 'attack')).toBeDefined();
    pushInput(s, c(), 40, false);
    expect(latest(s, 'attack')).toBeUndefined();
  });
  it('the newest request wins, and consuming it removes older presses of the same button', () => {
    const s = newInputState();
    pushInput(s, c({ attack: true }), 0, false); pushInput(s, c(), 1, false); pushInput(s, c({ attack: true }), 2, false);
    const newest = latest(s, 'attack')!;
    expect(newest.tick).toBe(2);
    consume(s, newest);
    expect(s.requests).toHaveLength(0);
  });
  it('consuming a chord removes the other buttons pressed on the same tick, but keeps later presses', () => {
    const s = newInputState();
    pushInput(s, c({ jump: true, special: true, up: true }), 0, false);
    pushInput(s, c({ grab: true }), 1, false);
    consume(s, latest(s, 'special')!);
    expect(latest(s, 'jump')).toBeUndefined(); expect(latest(s, 'grab')).toBeDefined();
  });
  it('discard removes every request of one button only', () => {
    const s = newInputState();
    pushInput(s, c({ special: true, attack: true }), 0, false);
    discard(s, 'special');
    expect(latest(s, 'special')).toBeUndefined(); expect(latest(s, 'attack')).toBeDefined();
  });
  it('pressedSince only counts presses made at or after a tick', () => {
    const s = newInputState();
    pushInput(s, c({ grab: true }), 4, false);
    expect(pressedSince(s, 'grab', 4)).toBe(true); expect(pressedSince(s, 'grab', 5)).toBe(false); expect(pressedSince(s, 'attack', 0)).toBe(false);
  });
  it('clearing with the held levels means a still-held button is not a fresh press afterwards', () => {
    const s = newInputState();
    pushInput(s, c({ attack: true }), 0, false);
    clearInputs(s, c({ attack: true }));
    expect(s.requests).toHaveLength(0);
    pushInput(s, c({ attack: true }), 1, false);
    expect(s.requests).toHaveLength(0);                              // still held: no edge
    pushInput(s, c(), 2, false); pushInput(s, c({ attack: true }), 3, false);
    expect(s.requests).toHaveLength(1);
  });
  it('while not live, levels are tracked but no request is created', () => {
    const s = newInputState();
    for (let i = 0; i < 10; i++) pushInput(s, c({ attack: true }), i, false, false);
    expect(s.requests).toHaveLength(0);
    pushInput(s, c({ attack: true }), 10, false, true);             // GO: the button is still held, so no surprise attack
    expect(s.requests).toHaveLength(0);
  });
  it('is plain data, so a fighter serialises and replays identically', () => {
    const s = newInputState();
    pushInput(s, c({ attack: true, x: 1 }), 0, false);
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
  });
});
