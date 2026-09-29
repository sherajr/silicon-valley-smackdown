import { MOVE_SPEED, WEIGHT, STAGE_PLATFORMS, SPECIAL_NAMES, RECOVERY_NAMES } from './data';
import type { Platform } from './data';

export type Mode = 'cpu' | 'versus' | 'arcade' | 'training';
export interface Controls { x: number; up: boolean; down: boolean; jump: boolean; attack: boolean; special: boolean; shield: boolean; grab: boolean }
export const noInput = (): Controls => ({ x: 0, up: false, down: false, jump: false, attack: false, special: false, shield: false, grab: false });
export type Move = 'jab' | 'heavy' | 'aerial' | 'upper' | 'sweep' | 'special' | 'recovery' | 'slam' | 'grab';
export interface Attack { kind: Move; age: number; duration: number; start: number; active: number; damage: number; force: number; reach: number; hit: boolean; fired: boolean }
export interface Fighter {
  slot: number; character: number; x: number; y: number; prevX: number; prevY: number; vx: number; vy: number;
  facing: number; damage: number; stocks: number; grounded: boolean; jumps: number; recovered: boolean;
  stun: number; invincible: number; respawn: number; shield: number; guarding: boolean; attack: Attack | null;
  combo: number; comboTimer: number; drop: number; roll: number; ledge: number; buff: number; flash: number;
  actionName: string; actionTime: number;
}
export interface Shot { id: number; owner: number; kind: number; x: number; y: number; vx: number; vy: number; life: number }
export interface Pickup { id: number; type: 'coffee' | 'gpu'; x: number; y: number; life: number }
export interface GameEvent { type: string; x: number; y: number; slot: number; value?: number; text?: string }
export interface MatchOptions { fighters: [number, number]; stage: number; mode: Mode; difficulty: number; items: boolean; seed?: number }
const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));

export function newFighter(slot: number, character: number): Fighter {
  const x = slot ? 4 : -4;
  return { slot, character, x, y: 0, prevX: x, prevY: 0, vx: 0, vy: 0, facing: slot ? -1 : 1, damage: 0, stocks: 3,
    grounded: true, jumps: 0, recovered: false, stun: 0, invincible: 0, respawn: 0, shield: 100, guarding: false,
    attack: null, combo: 0, comboTimer: 0, drop: 0, roll: 0, ledge: 0, buff: 0, flash: 0, actionName: '', actionTime: 0 };
}

/** A render-independent, seeded 60 Hz simulation. No wall clock, DOM, or Three.js dependencies. */
export class ArenaSim {
  fighters: [Fighter, Fighter];
  platforms: Platform[];
  options: MatchOptions;
  shots: Shot[] = [];
  pickups: Pickup[] = [];
  events: GameEvent[] = [];
  tick = 0;
  remaining = 5 * 60 * 60;
  countdown = 150;
  freeze = 0;
  finished = false;
  winner = -1;
  suddenDeath = false;
  private rng: number;
  private serial = 0;
  private itemClock = 600;
  private cpuAction = 0;

  constructor(options: MatchOptions) {
    this.options = options;
    this.fighters = [newFighter(0, options.fighters[0]), newFighter(1, options.fighters[1])];
    this.platforms = STAGE_PLATFORMS[options.stage];
    this.rng = options.seed ?? 49173;
  }
  random() { this.rng = (Math.imul(this.rng, 1664525) + 1013904223) >>> 0; return this.rng / 4294967296; }
  emit(type: string, f: Fighter, value?: number, text?: string) { this.events.push({ type, x: f.x, y: f.y + 1, slot: f.slot, value, text }); }
  step(inputs: [Controls, Controls]) {
    if (this.finished) return;
    this.tick++;
    for (const f of this.fighters) { f.prevX = f.x; f.prevY = f.y; }
    if (this.countdown > 0) { this.countdown--; return; }
    if (this.options.mode !== 'training' && --this.remaining <= 0) { this.timeout(); return; }
    if (this.freeze > 0) { this.freeze--; return; }
    const commands: [Controls, Controls] = [inputs[0], this.options.mode === 'versus' || this.options.mode === 'training' ? inputs[1] : this.cpu()];
    // Update both movement/timelines before testing either player's hitbox.
    for (const f of this.fighters) this.updateFighter(f, commands[f.slot]);
    const pending = this.fighters.map(f => ({ f, attack: f.attack, stunned: f.stun > 0 }));
    for (const { f, attack, stunned } of pending) this.resolveAttack(f, this.fighters[1 - f.slot], attack, stunned);
    this.updateShots();
    this.updatePickups();
    // Resolve both blast zones together, so simultaneous final-stock KOs are a draw/sudden death.
    for (const f of this.fighters) if (!f.respawn && f.stocks > 0 && (Math.abs(f.x) > 21 || f.y < -11 || f.y > 19)) this.ko(f);
    if (this.options.mode !== 'training') {
      if (this.fighters.every(f => f.stocks === 0)) this.startSuddenDeath();
      else if (this.fighters.some(f => f.stocks === 0)) this.finish(this.fighters[0].stocks > 0 ? 0 : 1);
    }
  }

  private updateFighter(f: Fighter, c: Controls) {
    for (const key of ['invincible', 'drop', 'buff', 'flash', 'comboTimer', 'actionTime'] as const) if (f[key] > 0) f[key]--;
    if (!f.comboTimer) f.combo = 0;
    if (f.respawn > 0) {
      if (--f.respawn === 0) { f.x = f.slot ? 3 : -3; f.y = 7; f.prevX = f.x; f.prevY = f.y; f.invincible = 120; f.vx = f.vy = 0; }
      return;
    }
    if (f.stocks <= 0) return;
    if (f.ledge > 0) { f.ledge--; return; }
    if (f.attack && ++f.attack.age >= f.attack.duration) f.attack = null;
    if (f.stun > 0) {
      f.stun--;
      // Directional influence helps a launched fighter bend their trajectory.
      f.vx += c.x * 0.0022;
      f.vy += (c.up ? 0.0008 : c.down ? -0.001 : 0);
    }
    if (f.roll > 0) { f.roll--; f.vx = f.facing * 0.25; }
    f.guarding = c.shield && f.grounded && !f.attack && !f.stun && !f.roll;
    if (f.guarding) {
      f.shield -= 0.32;
      if (f.shield <= 0) this.breakShield(f);
      else if (Math.abs(c.x) > 0.6) { f.roll = 25; f.facing = Math.sign(c.x); f.invincible = 19; f.guarding = false; this.emit('roll', f); }
    } else f.shield = Math.min(100, f.shield + 0.17);
    if (!f.stun && !f.roll) {
      if (!f.attack && !f.guarding) {
        if (c.x) f.facing = Math.sign(c.x);
        if (c.special && c.up && !f.recovered) this.startAttack(f, 'recovery');
        else if (c.special) this.startAttack(f, c.down ? 'slam' : 'special');
        else if (c.grab) this.startAttack(f, 'grab');
        else if (c.attack) this.startAttack(f, !f.grounded ? 'aerial' : c.down ? 'sweep' : c.up ? 'upper' : c.x ? 'heavy' : 'jab');
        else if (c.jump && f.jumps < 2) {
          f.vy = f.jumps === 0 ? 0.315 : 0.295; f.jumps++; f.grounded = false; this.emit('jump', f);
        }
        if (c.down && f.grounded && f.y > 0.1 && !f.attack) { f.drop = 18; f.grounded = false; f.y -= 0.12; }
      }
      if (!f.attack && !f.guarding) {
        const target = c.x * MOVE_SPEED[f.character];
        f.vx += (target - f.vx) * (f.grounded ? 0.30 : 0.062);
      } else if (f.grounded) f.vx *= 0.8;
      if (c.down && !f.grounded && f.vy < 0 && !f.attack) f.vy -= 0.010;
    } else f.vx *= f.grounded ? 0.91 : 0.996;

    const oldY = f.y;
    f.x += f.vx;
    f.vy = Math.max(-0.52, f.vy - 0.0135);
    f.y += f.vy;
    const wasGrounded = f.grounded;
    f.grounded = false;
    if (f.vy <= 0) for (const p of this.platforms) {
      if (p.y > 0 && f.drop > 0) continue;
      if (Math.abs(f.x - p.x) < p.w / 2 + 0.10 && oldY >= p.y - 0.04 && f.y <= p.y) {
        f.y = p.y; f.vy = 0; f.grounded = true; f.jumps = 0; f.recovered = false;
        if (!wasGrounded) { this.emit('land', f); if (f.attack?.kind === 'slam') f.attack.age = Math.max(f.attack.age, f.attack.start); }
        break;
      }
    }
    // Walking off an edge consumes the ground jump, leaving one air jump.
    if (!f.grounded && f.jumps === 0) f.jumps = 1;
    if (!f.grounded && f.vy < 0 && !f.stun && c.x * f.x < 0 && f.y > -0.9 && f.y < 0.1 && Math.abs(f.x) > 9.5 && Math.abs(f.x) < 10.15) {
      f.x = Math.sign(f.x) * 9.2; f.y = 0; f.vx = f.vy = 0; f.ledge = 18; f.invincible = 35;
      f.jumps = 0; f.recovered = false; f.grounded = true; f.attack = null; this.emit('ledge', f);
    }
  }

  startAttack(f: Fighter, kind: Move) {
    const specs: Record<Move, [number, number, number, number, number, number]> = {
      jab: [5, 4, 20, 5 + f.combo * 2, f.combo === 2 ? 0.15 : 0.075, 1.6],
      heavy: [12, 5, 35, 15, 0.24, 2.05], aerial: [6, 9, 29, 10, 0.15, 1.9], upper: [8, 5, 29, 12, 0.19, 1.55],
      sweep: [7, 5, 27, 9, 0.14, 1.95], special: [14, 1, 40, 10, 0.14, 0], recovery: [1, 17, 43, 9, 0.14, 1.5],
      slam: [10, 12, 39, 16, 0.23, 2.5], grab: [8, 4, 34, 12, 0.23, 1.5],
    };
    const [start, active, duration, damage, force, reach] = specs[kind];
    f.attack = { kind, age: 0, start, active, duration, damage, force, reach, hit: false, fired: false };
    if (kind === 'jab') { f.combo = (f.combo + 1) % 3; f.comboTimer = 54; }
    if (kind === 'recovery') {
      f.recovered = true; f.grounded = false; f.jumps = 2; f.vy = 0.43; f.vx = f.facing * 0.12;
      f.actionName = RECOVERY_NAMES[f.character]; this.emit('recovery', f);
    } else if (kind === 'special') f.actionName = SPECIAL_NAMES[f.character];
    else if (kind === 'grab') f.actionName = 'HOSTILE TAKEOVER';
    else if (kind === 'heavy') f.actionName = 'DISRUPT!';
    else if (kind === 'slam') { f.actionName = 'DOWN ROUND'; if (!f.grounded) f.vy = -0.42; }
    else f.actionName = '';
    f.actionTime = 45;
  }

  private resolveAttack(f: Fighter, opponent: Fighter, a: Attack | null, stunned: boolean) {
    // Snapshot both attacks before applying damage: same-frame hits can trade fairly.
    if (!a || f.respawn || stunned || a.age < a.start || a.age >= a.start + a.active || a.hit) return;
    if (a.kind === 'special') {
      if (!a.fired) { a.fired = true; this.shots.push({ id: ++this.serial, owner: f.slot, kind: f.character, x: f.x + f.facing * 0.8, y: f.y + 1.25,
        vx: f.facing * (f.character === 3 ? 0.32 : 0.25), vy: f.character === 1 || f.character === 2 ? 0.115 : 0, life: 100 }); this.emit('shot', f); }
      return;
    }
    const dx = opponent.x - f.x;
    const vertical = Math.abs((opponent.y + 1) - (f.y + (a.kind === 'upper' ? 1.7 : 1)));
    const bilateral = a.kind === 'slam' || a.kind === 'recovery';
    if (vertical < (a.kind === 'aerial' ? 1.65 : 1.45) && Math.abs(dx) < a.reach && (bilateral || dx * f.facing > -0.35)) {
      if (opponent.invincible || opponent.respawn || opponent.stocks <= 0) return;
      a.hit = true;
      this.hit(f, opponent, a.damage, a.force, a.kind);
    }
  }

  hit(attacker: Fighter, target: Fighter, damage: number, force: number, kind: Move | 'projectile') {
    if (target.invincible || target.respawn || target.stocks <= 0) return;
    const direction = Math.sign(target.x - attacker.x) || attacker.facing;
    if (target.guarding && kind !== 'grab') {
      target.shield -= damage * 2.4; target.vx = direction * 0.08; this.freeze = 3;
      this.emit('block', target); if (target.shield <= 0) this.breakShield(target); return;
    }
    const buff = attacker.buff > 0 ? 1.25 : 1;
    target.damage = Math.min(999, target.damage + damage * buff);
    const launch = (force + target.damage * 0.0029) / WEIGHT[target.character] * (buff > 1 ? 1.1 : 1);
    target.vx = direction * launch * (kind === 'upper' || kind === 'recovery' ? 0.35 : 1);
    target.vy = launch * (kind === 'upper' || kind === 'recovery' ? 1.1 : 0.62) + 0.065;
    target.grounded = false; target.stun = Math.round(11 + launch * 38); target.attack = null;
    target.flash = 12; target.guarding = false; target.ledge = 0; target.roll = 0;
    this.freeze = kind === 'heavy' || kind === 'grab' ? 7 : 5;
    this.emit('hit', target, damage * buff, kind);
  }
  private breakShield(f: Fighter) { f.shield = 12; f.guarding = false; f.stun = 90; f.vy = 0.15; this.emit('break', f); }
  private updateShots() {
    for (const s of this.shots) {
      s.x += s.vx; s.y += s.vy; s.life--;
      if (s.kind === 1 || s.kind === 2) s.vy -= 0.004;
      const target = this.fighters[1 - s.owner];
      if (Math.abs(s.x - target.x) < 0.65 && s.y > target.y && s.y < target.y + 2.35 && !target.respawn && !target.invincible) {
        this.hit(this.fighters[s.owner], target, s.kind === 3 ? 8 : 12, 0.13, 'projectile'); s.life = 0;
      }
    }
    this.shots = this.shots.filter(s => s.life > 0 && Math.abs(s.x) < 24 && s.y > -12);
  }
  private updatePickups() {
    if (this.options.items && --this.itemClock <= 0) {
      this.itemClock = 900;
      const p = this.platforms[1 + Math.floor(this.random() * (this.platforms.length - 1))];
      this.pickups.push({ id: ++this.serial, type: this.random() > 0.5 ? 'gpu' : 'coffee', x: p.x, y: p.y + 0.55, life: 720 });
    }
    for (const p of this.pickups) {
      p.life--;
      for (const f of this.fighters) if (!f.respawn && f.stocks > 0 && Math.abs(f.x - p.x) < 0.9 && Math.abs(f.y + 0.7 - p.y) < 1) {
        if (p.type === 'coffee') f.damage = Math.max(0, f.damage - 22); else f.buff = 480;
        this.emit('pickup', f, 0, p.type === 'coffee' ? 'COFFEE −22%' : 'GPU OVERCLOCK'); p.life = 0; break;
      }
    }
    this.pickups = this.pickups.filter(p => p.life > 0);
  }
  private ko(f: Fighter) {
    this.emit('ko', f, f.damage); if (this.options.mode !== 'training') f.stocks--;
    f.damage = 0; f.vx = f.vy = 0; f.stun = 0; f.attack = null; f.guarding = false;
    f.jumps = 0; f.recovered = false; f.buff = 0; f.roll = 0; f.ledge = 0; f.shield = 100; f.respawn = 70;
    this.shots = this.shots.filter(s => s.owner !== f.slot);
  }
  private timeout() {
    const [a, b] = this.fighters;
    if (a.stocks !== b.stocks) this.finish(a.stocks > b.stocks ? 0 : 1);
    else if (Math.abs(a.damage - b.damage) > 0.001) this.finish(a.damage < b.damage ? 0 : 1);
    else this.startSuddenDeath();
  }
  private startSuddenDeath() {
    this.suddenDeath = true; this.remaining = 90 * 60; this.countdown = 90;
    this.fighters = this.fighters.map(f => ({ ...newFighter(f.slot, f.character), damage: 150, stocks: 1 })) as [Fighter, Fighter];
    this.shots = []; this.pickups = []; this.freeze = 0;
    this.events.push({ type: 'sudden', x: 0, y: 5, slot: 0 });
  }
  private finish(winner: number) { this.finished = true; this.winner = winner; this.emit('finish', this.fighters[winner]); }

  private cpu(): Controls {
    const c = noInput(), f = this.fighters[1], opponent = this.fighters[0];
    if (f.respawn || f.stocks === 0) return c;
    const dx = opponent.x - f.x, dy = opponent.y - f.y;
    const offstage = Math.abs(f.x) > 9.0 || f.y < -0.15;
    if (offstage) {
      c.x = -Math.sign(f.x);
      if (f.vy < 0.06 && this.tick % 10 === 0 && f.jumps < 2) c.jump = true;
      if (f.y < -1.2 && f.vy < 0.08 && f.jumps >= 2 && !f.recovered) { c.up = true; c.special = true; }
      return c;
    }
    c.x = Math.abs(dx) > 1.35 ? Math.sign(dx) : 0;
    if (Math.abs(f.x) > 8.5 && c.x === Math.sign(f.x)) c.x = 0;
    if (dy > 1.5 && f.vy <= 0.01 && f.jumps < 2 && this.tick % 23 === 0) c.jump = true;
    if (dy < -1.8 && f.grounded && f.y > 0) c.down = true;
    const level = this.options.difficulty;
    if (--this.cpuAction <= 0) {
      this.cpuAction = 12 + (2 - level) * 9 + Math.floor(this.random() * 12);
      if (Math.abs(dx) < 2.2 && Math.abs(dy) < 1.7) {
        if (opponent.guarding && this.random() < 0.7) c.grab = true;
        else { c.attack = true; if (this.random() < 0.35) c.x = Math.sign(dx); }
      } else if (Math.abs(dx) > 3 && Math.abs(dy) < 1.6 && this.random() < 0.5 + level * 0.15) c.special = true;
      if (f.grounded && this.random() < 0.10 + level * 0.06) c.jump = true;
    }
    if (level > 0 && opponent.attack && Math.abs(dx) < 2.9 && Math.abs(dy) < 1.6 && this.tick % 80 < 25 + level * 8) { c.shield = true; c.x = 0; }
    if (dx) f.facing = Math.sign(dx);
    return c;
  }
}
