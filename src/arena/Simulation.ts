import { STAGE_PLATFORMS } from './data';
import type { Platform } from './data';
import { FIGHTERS } from './fighterDefinitions';
import type { FighterDef } from './fighterDefinitions';
import { defaultStop, moveReach, resolveMoveId } from './moveDefinitions';
import type { HitWindow, Launch, Move, MoveDef, MoveId, ProjectileDef } from './moveDefinitions';
import { clearInputs, consume, discard, latest, newInputState, pressedSince, pushInput } from './ActionBuffer';
import type { InputState, Request } from './ActionBuffer';
import { buildStage, moveBody, segmentHitsRect, segmentHitsSolid, supportSpan } from './collision';
import type { Ledge, Stage } from './collision';
import { CATCH_STOP, GRAB_PROTECT, HOLD_MAX, HOLD_PULL, PUMMEL_GAP, PUMMEL_HIT, PUMMEL_MAX, SEPARATE, TECH_FRAMES, TECH_LAG, canBeCaught, catchConnects, holdPosition, rectsOverlap, throwDirection, throwMoveId, worldBox } from './grabs';
import type { ThrowDir } from './grabs';
import { noInput } from './controls';
import type { Controls } from './controls';
import { cpuControls } from './cpu';
import type { CpuState } from './cpu';
import { applySnapshot, buildSnapshot, hashSnapshot } from './snapshot';
import type { SimSnapshot } from './snapshot';

export { noInput };
export type { Controls, Move, MoveId };
export type Mode = 'cpu' | 'versus' | 'arcade' | 'training';

const GRAVITY = 0.0135, FAST_FALL = 0.010, GROUND_ACCEL = 0.30;
const MAX_LAUNCH = 1.4, JAB_GRACE = 14, DROP_FRAMES = 18;
const ROLL_FRAMES = 25, ROLL_INVULN = 19, ROLL_SPEED = 0.25, ROLL_LAG = 10, ROLL_EDGE = 0.15;
const LEDGE_FRAMES = 18, LEDGE_COOLDOWN = 50, LEDGE_INVULN = [35, 20, 8, 0];
const SHIELD_DRAIN = 0.32, SHIELD_REGEN = 0.17;
const DI_X = 0.0022, DI_Y = 0.001, DI_CAP_X = 0.05, DI_CAP_Y = 0.03;
/** Shortest centre-to-centre spacing is the sum of both pushbox half-widths. */
const PUSH_HEIGHT = 0.3, EDGE_MARGIN = 0.12;
const TIMERS = ['invincible', 'drop', 'buff', 'flash', 'actionTime', 'busy', 'grabProtect', 'ledgeCooldown'] as const;

/** A move in progress. `kind`, `age`, `duration`, `start`, `active` keep their original meaning. */
export interface Attack {
  kind: Move; id: MoveId; uid: number; def: MoveDef;
  age: number; duration: number; start: number; active: number;
  damage: number; force: number; reach: number;
  /** Any window has connected (hit or blocked). */
  hit: boolean;
  /** A real hit landed (not blocked). Gates on-hit cancels. */
  landed: boolean;
  blocked: boolean;
  fired: boolean;
  /** Down-special fall in progress: the timeline is held until the fighter touches down. */
  diving: boolean;
  /** This counter already fired. */
  countered: boolean;
  /** `window:target` -> age the window last hit. Makes every multi-hit rule explicit. */
  log: Record<string, number>;
}
export interface Hold { target: number; age: number; tick: number; pummels: number; gap: number }
export interface Fighter {
  slot: number; character: number; x: number; y: number; prevX: number; prevY: number; vx: number; vy: number;
  facing: number; damage: number; stocks: number; grounded: boolean; support: string | null; jumps: number; recovered: boolean;
  stun: number; invincible: number; respawn: number; shield: number; guarding: boolean; attack: Attack | null;
  /** Next jab in the three-hit string (0 = first). Not a combo counter: it advances on whiffs too. */
  jabSequenceIndex: number; jabWindow: number;
  /** Confirmed combo: hits this fighter has landed without the defender regaining action. */
  combo: number; comboDamage: number; comboTarget: number;
  drop: number; dropFrom: string | null; roll: number; /** Protection the fighter already had when a roll began (respawn, ledge): a roll never shortens it. */ rollBase: number; ledge: number; ledgeCooldown: number; ledgeGrabs: number; buff: number; flash: number;
  /** Non-actionable lag that is not hitstun: tech recovery, landing lag, roll end. `busyKind` names it for animation. */
  busy: number; busyKind: string;
  hold: Hold | null; heldBy: number | null; grabProtect: number;
  di: number; diY: number;
  input: InputState;
  actionName: string; actionTime: number;
}
export interface Shot { id: number; owner: number; kind: number; x: number; y: number; vx: number; vy: number; life: number; dir: number; bounces: number; def: ProjectileDef }
export interface Pickup { id: number; type: 'coffee' | 'gpu'; x: number; y: number; life: number }
export interface GameEvent { type: string; x: number; y: number; slot: number; value?: number; text?: string }
export interface MatchOptions { fighters: [number, number]; stage: number; mode: Mode; difficulty: number; items: boolean; seed?: number }
export type DummyMode = 'idle' | 'shield' | 'jump' | 'diLeft' | 'diRight' | 'tech';

interface HitSpec { damage: number; launch: Launch; stun?: number; stunScale?: number; stop?: number; dirSign: number; kind: Move | 'projectile' }
interface Strike { f: Fighter; v: Fighter; a: Attack; w: HitWindow; key: string }
type Intent = { kind: 'move'; move: MoveId } | { kind: 'jump' } | { kind: 'fizzle' };

const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));

export function newFighter(slot: number, character: number): Fighter {
  const x = slot ? 4 : -4;
  return { slot, character, x, y: 0, prevX: x, prevY: 0, vx: 0, vy: 0, facing: slot ? -1 : 1, damage: 0, stocks: 3,
    grounded: true, support: 'main', jumps: 0, recovered: false, stun: 0, invincible: 0, respawn: 0, shield: 100, guarding: false,
    attack: null, jabSequenceIndex: 0, jabWindow: 0, combo: 0, comboDamage: 0, comboTarget: -1,
    drop: 0, dropFrom: null, roll: 0, rollBase: 0, ledge: 0, ledgeCooldown: 0, ledgeGrabs: 0, buff: 0, flash: 0, busy: 0, busyKind: '',
    hold: null, heldBy: null, grabProtect: 0, di: 0, diY: 0, input: newInputState(), actionName: '', actionTime: 0 };
}

/** Hurtbox of a fighter in world space. */
export const hurtboxOf = (f: Fighter) => { const h = FIGHTERS[f.character].hurt; return { x0: f.x - h.hw, x1: f.x + h.hw, y0: f.y, y1: f.y + h.h }; };

/** World boxes of a fighter's currently active hit windows (for the training hitbox display). */
export function activeBoxes(f: Fighter) {
  const a = f.attack;
  if (!a || a.diving) return [];
  const out = a.def.hits.filter(w => a.age >= w.from && a.age <= w.to).map(w => worldBox(w.box, f.x, f.y, f.facing));
  if (a.def.grab && a.age >= a.def.grab.from && a.age <= a.def.grab.to) out.push(worldBox(a.def.grab.box, f.x, f.y, f.facing));
  return out;
}

/** A render-independent, seeded 60 Hz simulation. No wall clock, DOM, or Three.js dependencies. */
export class ArenaSim {
  fighters: [Fighter, Fighter];
  platforms: Platform[];
  stage: Stage;
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
  /** Practice-only: how the dummy behaves when no human drives P2. */
  dummy: DummyMode = 'idle';
  /** CPU decision timers. Part of the simulation so seeded matches replay exactly. */
  cpu: CpuState = { action: 0, techAt: -1 };
  private rng: number;
  private serial = 0;
  private itemClock = 600;

  constructor(options: MatchOptions) {
    this.options = options;
    this.fighters = [newFighter(0, options.fighters[0]), newFighter(1, options.fighters[1])];
    this.platforms = STAGE_PLATFORMS[options.stage];
    this.stage = buildStage(this.platforms);
    this.rng = options.seed ?? 49173;
  }
  /** Replaces the stage geometry. Collision, ledges and pickups all follow the same platform data. */
  setPlatforms(platforms: Platform[]) { this.platforms = platforms; this.stage = buildStage(platforms); }
  random() { this.rng = (Math.imul(this.rng, 1664525) + 1013904223) >>> 0; return this.rng / 4294967296; }
  emit(type: string, f: Fighter, value?: number, text?: string) { this.events.push({ type, x: f.x, y: f.y + 1, slot: f.slot, value, text }); }
  def(f: Fighter): FighterDef { return FIGHTERS[f.character]; }

  step(inputs: [Controls, Controls]) {
    if (this.finished) return;
    this.tick++;
    for (const f of this.fighters) { f.prevX = f.x; f.prevY = f.y; }
    if (this.countdown > 0) {
      // Not live yet: track held buttons so a button held through the countdown is not a fresh press at GO.
      for (const f of this.fighters) pushInput(f.input, inputs[f.slot], this.tick, false, false);
      this.countdown--; return;
    }
    if (this.options.mode !== 'training' && --this.remaining <= 0) { this.timeout(); return; }
    const mode = this.options.mode;
    const commands: [Controls, Controls] = [inputs[0], mode === 'versus' ? inputs[1] : mode === 'training' ? this.trainingControls(inputs[1]) : cpuControls(this)];
    // Presses are captured every tick, hitstop included, so none is lost to a freeze.
    const frozen = this.freeze > 0;
    for (const f of this.fighters) pushInput(f.input, commands[f.slot], this.tick, frozen);
    if (frozen) { this.freeze--; return; }
    // Update both fighters' movement/timelines before testing either hitbox, so same-frame hits trade fairly.
    for (const f of this.fighters) this.updateFighter(f, commands[f.slot]);
    // Holds touch both fighters, so they resolve after both have moved: the outcome never depends on slot order.
    for (const f of this.fighters) if (f.hold) this.updateHold(f);
    this.resolveContacts();
    this.updateShots();
    this.updatePickups();
    this.resolvePush();
    // Resolve both blast zones together, so simultaneous final-stock KOs are a draw/sudden death.
    for (const f of this.fighters) if (!f.respawn && f.stocks > 0 && (Math.abs(f.x) > 21 || f.y < -11 || f.y > 19 || !Number.isFinite(f.x + f.y))) this.ko(f);
    this.updateCombos();
    if (this.options.mode !== 'training') {
      if (this.fighters.every(f => f.stocks === 0)) this.startSuddenDeath();
      else if (this.fighters.some(f => f.stocks === 0)) this.finish(this.fighters[0].stocks > 0 ? 0 : 1);
    }
  }

  /** Forgets buffered presses on both fighters. Called on launch, pause/resume, and other hard transitions. */
  clearInputs(held?: [Controls, Controls]) { for (const f of this.fighters) clearInputs(f.input, held?.[f.slot]); }

  private trainingControls(human: Controls): Controls {
    // Any P2 input takes over the dummy; otherwise the selected dummy behaviour drives it.
    if (human.x || human.up || human.down || human.jump || human.attack || human.special || human.shield || human.grab) return human;
    const c = noInput(), f = this.fighters[1], opponent = this.fighters[0];
    switch (this.dummy) {
      case 'shield': c.shield = true; break;
      case 'jump': if (f.grounded && this.tick % 75 === 0) c.jump = true; break;
      case 'diLeft': if (f.stun > 0) c.x = -1; break;
      case 'diRight': if (f.stun > 0) c.x = 1; break;
      case 'tech': if (f.heldBy === 0 && opponent.hold && opponent.hold.age === 3) c.grab = true; break;
      default: break;
    }
    return c;
  }

  // ---------------------------------------------------------------------------------------------------
  // Per-fighter update
  // ---------------------------------------------------------------------------------------------------
  private updateFighter(f: Fighter, c: Controls) {
    const def = this.def(f);
    for (const key of TIMERS) if (f[key] > 0) f[key]--;
    if (f.jabWindow > 0 && --f.jabWindow === 0) f.jabSequenceIndex = 0;
    if (f.respawn > 0) {
      if (--f.respawn === 0) {
        f.x = f.slot ? 3 : -3; f.y = 7; f.prevX = f.x; f.prevY = f.y; f.invincible = 120; f.vx = f.vy = 0; f.grounded = false; f.support = null;
        clearInputs(f.input, c);
      }
      return;
    }
    if (f.stocks <= 0) return;
    if (f.heldBy !== null) { f.vx = f.vy = 0; f.guarding = false; return; }
    if (f.ledge > 0) { f.ledge--; return; }
    if (f.attack) this.advanceAttack(f);

    if (f.stun > 0) {
      f.stun--;
      // Directional influence bends a launched fighter's trajectory, within a fixed per-hit budget.
      const dx = clamp(c.x * DI_X, -DI_CAP_X - f.di, DI_CAP_X - f.di), dy = clamp(c.up ? DI_Y * 0.8 : c.down ? -DI_Y : 0, -DI_CAP_Y - f.diY, DI_CAP_Y - f.diY);
      f.vx += dx; f.di += dx; f.vy += dy; f.diY += dy;
    }
    if (f.roll > 0) this.rollStep(f);
    const canGuard = f.grounded && !f.attack && !f.stun && !f.roll && f.busy === 0 && !f.hold;
    f.guarding = c.shield && canGuard;
    if (f.guarding) {
      f.shield -= SHIELD_DRAIN;
      if (f.shield <= 0) this.breakShield(f);
      else if (Math.abs(c.x) > 0.6) {
        const dir = Math.sign(c.x), span = supportSpan(this.stage, f.support);
        // No room to roll toward an edge you are already at: just turn to face it and stay shielded.
        if (span && (f.x - (dir > 0 ? span.x1 - ROLL_EDGE : span.x0 + ROLL_EDGE)) * dir >= 0) f.facing = dir;
        else { f.rollBase = f.invincible; f.roll = ROLL_FRAMES; f.facing = dir; f.invincible = Math.max(f.invincible, ROLL_INVULN); f.guarding = false; this.emit('roll', f); }
      }
    } else f.shield = Math.min(100, f.shield + SHIELD_REGEN);

    const free = !f.stun && !f.roll && f.busy === 0 && f.ledge === 0;
    if (free) {
      if (f.hold) this.holdActions(f, def);
      else this.actions(f, c, def);
    }
    this.locomotion(f, c, def, free);
    this.physics(f, c, def);
    if (!Number.isFinite(f.x + f.y + f.vx + f.vy)) { f.x = f.slot ? 3 : -3; f.y = 7; f.vx = f.vy = 0; f.attack = null; }
  }

  private advanceAttack(f: Fighter) {
    const a = f.attack!, d = a.def;
    if (d.dive && a.diving) return;
    a.age++;
    if (d.dive && a.age >= d.start) {
      if (!f.grounded) { a.age = d.start - 1; a.diving = true; return; }
      if (a.age === d.start) this.emit('impact', f);
    }
    if (d.projectile && !a.fired && a.age >= d.projectile.fire) this.fire(f, a, d.projectile);
    if (a.age >= a.duration) {
      f.attack = null;
      if (a.kind === 'jab' && f.jabSequenceIndex !== 0) f.jabWindow = JAB_GRACE;
    }
  }

  private fire(f: Fighter, a: Attack, p: ProjectileDef) {
    a.fired = true;
    this.shots.push({ id: ++this.serial, owner: f.slot, kind: f.character, x: f.x + f.facing * p.spawn.x, y: f.y + p.spawn.y, vx: f.facing * p.vx, vy: p.vy, life: p.life, dir: f.facing, bounces: 0, def: p });
    this.emit('shot', f);
  }

  private rollStep(f: Fighter) {
    f.roll--; f.vx = f.facing * ROLL_SPEED;
    const span = supportSpan(this.stage, f.support);
    if (!f.grounded || !span) { f.roll = 0; f.vx = 0; return; }
    // A roll never carries a fighter over an edge: it stops there and ends.
    const limit = f.facing > 0 ? span.x1 - ROLL_EDGE : span.x0 + ROLL_EDGE;
    // Stopping early also ends the roll's own protection, so rolling into an edge cannot chain invincibility.
    // Protection the fighter already had (respawn, ledge) keeps counting down as if the roll never happened.
    if ((f.x + f.vx - limit) * f.facing > 0) { f.x = f.facing > 0 ? Math.max(f.x, limit) : Math.min(f.x, limit); f.vx = 0; f.invincible = Math.max(0, f.rollBase - (ROLL_FRAMES - f.roll)); f.roll = 0; }
    if (f.roll === 0) { f.busy = ROLL_LAG; f.busyKind = 'roll'; }
  }

  // ---------------------------------------------------------------------------------------------------
  // Buffered actions
  // ---------------------------------------------------------------------------------------------------
  /** What a request means for this fighter right now. Direction is the one held when the button was pressed. */
  private intent(f: Fighter, r: Request): Intent {
    switch (r.button) {
      case 'jump': return { kind: 'jump' };
      case 'grab': return { kind: 'move', move: 'grab' };
      case 'special':
        if (r.up) return f.recovered ? { kind: 'fizzle' } : { kind: 'move', move: 'recovery' };
        return { kind: 'move', move: r.down ? 'down' : 'special' };
      default:
        if (!f.grounded) {
          if (r.up) return { kind: 'move', move: 'uair' };
          if (r.down) return { kind: 'move', move: 'dair' };
          if (r.x === 0) return { kind: 'move', move: 'nair' };
          return { kind: 'move', move: Math.sign(r.x) === f.facing ? 'fair' : 'bair' };
        }
        if (r.down) return { kind: 'move', move: 'sweep' };
        if (r.up) return { kind: 'move', move: 'upper' };
        if (r.x) return { kind: 'move', move: 'heavy' };
        return { kind: 'move', move: `jab${(f.attack?.kind === 'jab' || f.jabWindow > 0 ? f.jabSequenceIndex : 0) + 1}` as MoveId };
    }
  }

  private allowed(f: Fighter, it: Intent): boolean {
    if (it.kind === 'fizzle') return false;
    if (f.attack) return this.cancelAllowed(f, f.attack, it);
    if (it.kind === 'jump') return f.jumps < 2;
    if (f.guarding) return it.move === 'grab';
    return it.move !== 'grab' || f.grounded;
  }

  private cancelAllowed(f: Fighter, a: Attack, it: Intent): boolean {
    if (it.kind === 'fizzle') return false;
    const into = it.kind === 'jump' ? 'jump' : it.move;
    if (it.kind === 'jump' && f.jumps >= 2) return false;
    if (into === 'grab' && !f.grounded) return false;
    for (const c of a.def.cancels ?? []) {
      if (c.into !== into || a.age < c.from || (c.to !== undefined && a.age > c.to)) continue;
      if (c.on === 'hit' && !a.landed) continue;
      if (c.on === 'contact' && !a.hit) continue;
      return true;
    }
    return false;
  }

  /** Runs the highest-priority buffered request that is legal now. Priority: special > grab > attack > jump. */
  private actions(f: Fighter, c: Controls, def: FighterDef) {
    for (const button of ['special', 'grab', 'attack', 'jump'] as const) {
      const r = latest(f.input, button);
      if (!r) continue;
      const it = this.intent(f, r);
      if (it.kind === 'fizzle') { discard(f.input, 'special'); this.emit('fizzle', f); continue; }
      if (!this.allowed(f, it)) continue;
      consume(f.input, r);
      f.guarding = false;
      if (it.kind === 'jump') { f.attack = null; this.jump(f, r, c, def); }
      else {
        const move = it.move;
        // Ground moves turn toward the held direction. Only a back aerial keeps the facing: it hits behind.
        if (r.x && move !== 'bair') f.facing = Math.sign(r.x);
        this.startMove(f, def.moves[move]);
      }
      return;
    }
    if (f.grounded && !f.attack && !f.guarding && c.x) f.facing = Math.sign(c.x);
  }

  private jump(f: Fighter, r: Request, c: Controls, def: FighterDef) {
    const air = f.jumps > 0;
    f.vy = f.jumps === 0 ? def.jump[0] : def.jump[1]; f.jumps++; f.grounded = false; f.support = null;
    if (air && (r.x || c.x)) f.facing = Math.sign(r.x || c.x);
    this.emit('jump', f);
  }

  startMove(f: Fighter, d: MoveDef) {
    const w = d.hits[0], p = d.projectile;
    f.attack = { kind: d.kind, id: d.id, uid: ++this.serial, def: d, age: 0, duration: d.duration, start: d.start, active: d.active,
      damage: w?.damage ?? p?.damage ?? 0, force: w?.launch.base ?? p?.launch.base ?? 0, reach: moveReach(d),
      hit: false, landed: false, blocked: false, fired: false, diving: false, countered: false, log: {} };
    if (d.kind === 'jab') { f.jabSequenceIndex = Number(d.id.slice(3)) % 3; f.jabWindow = 0; } else { f.jabSequenceIndex = 0; f.jabWindow = 0; }
    f.actionName = d.kind === 'jab' || d.kind === 'aerial' || d.kind === 'upper' || d.kind === 'sweep' ? '' : d.name;
    f.actionTime = 45;
    if (d.kind === 'recovery' && d.recovery) {
      f.recovered = true; f.grounded = false; f.support = null; f.jumps = 2; f.vy = d.recovery.vy; f.vx = f.facing * d.recovery.vx; this.emit('recovery', f);
    }
  }

  /** Test and debug entry point. Accepts the original move names ('jab', 'heavy', 'slam', ...) or any move slot. */
  startAttack(f: Fighter, kind: Move | MoveId) { this.startMove(f, this.def(f).moves[resolveMoveId(kind)]); }

  // ---------------------------------------------------------------------------------------------------
  // Movement
  // ---------------------------------------------------------------------------------------------------
  private locomotion(f: Fighter, c: Controls, def: FighterDef, free: boolean) {
    const a = f.attack;
    if (free && !f.hold && !a && !f.guarding) {
      const target = c.x * def.walk * (f.grounded ? 1 : def.air);
      f.vx += (target - f.vx) * (f.grounded ? GROUND_ACCEL : def.airAccel);
      if (c.down && !f.grounded && f.vy < 0) f.vy -= FAST_FALL;
      if (c.down && f.grounded && f.support && this.stage.oneway.some(p => p.id === f.support)) {
        f.drop = DROP_FRAMES; f.dropFrom = f.support; f.grounded = false; f.support = null;
      }
    } else if (free && a) {
      const d = a.def, lunge = d.lunge?.find(l => a.age >= l.from && a.age <= l.to);
      if (lunge) f.vx = f.facing * lunge.vx;
      else if (f.grounded) f.vx *= d.slide ?? 0.8;
      if (!f.grounded) {
        if (a.diving || d.dive) f.vx *= 0.9;
        else {
          f.vx += (c.x * def.walk * def.air - f.vx) * (d.air ?? 0.5) * def.airAccel;
          if (d.recovery && c.x) f.vx = clamp(f.vx + c.x * d.recovery.drift, -0.42, 0.42);
        }
      }
    } else if (free || f.hold) {
      if (f.grounded) f.vx *= 0.8;
    } else f.vx *= f.busy > 0 && !f.stun && !f.roll ? (f.grounded ? 0.8 : 0.99) : f.grounded ? 0.91 : 0.996;
  }

  private physics(f: Fighter, c: Controls, def: FighterDef) {
    const a = f.attack;
    // A down special hangs briefly in the air, then falls at a fixed speed until it touches a surface.
    if (a?.diving) f.vy = -a.def.dive!.speed;
    else if (a?.def.dive && !f.grounded && a.age < a.start) f.vy = 0;
    else f.vy = Math.max(-def.fall, f.vy - GRAVITY);
    const result = moveBody(this.stage, { x: f.x, y: f.y, vx: f.vx, vy: f.vy, height: def.hurt.h }, { dropThrough: f.drop > 0 ? f.dropFrom : null });
    f.x = result.x; f.y = result.y; f.vx = result.vx; f.vy = result.vy; f.grounded = result.grounded; f.support = result.support;
    if (f.drop === 0) f.dropFrom = null;
    if (result.landed) this.land(f);
    // Walking off an edge consumes the ground jump, leaving one air jump.
    if (!f.grounded && f.jumps === 0) f.jumps = 1;
    if (!f.grounded && f.vy < 0 && !f.stun && f.ledgeCooldown === 0) for (const ledge of this.stage.ledges) {
      const outside = (f.x - ledge.x) * ledge.side, above = f.y - ledge.y;
      if (c.x * ledge.side < 0 && outside > 0 && outside < 0.65 && above > -0.9 && above < 0.1) { this.grabLedge(f, ledge); break; }
    }
  }

  private land(f: Fighter) {
    const spentRecovery = f.recovered, recoveryLag = this.def(f).moves.recovery.landing ?? 0;
    f.jumps = 0; f.recovered = false; f.ledgeGrabs = 0;
    this.emit('land', f);
    const a = f.attack;
    if (a?.def.dive && a.diving) { a.diving = false; a.age = a.def.start; this.emit('impact', f); }
    else if (a?.def.landing && a.def.aerial) { f.attack = null; f.busy = a.def.landing; f.busyKind = 'landing'; }
    else if (spentRecovery && recoveryLag && !f.stun) { f.attack = null; f.busy = recoveryLag; f.busyKind = 'landing'; }
  }

  private grabLedge(f: Fighter, ledge: Ledge) {
    f.x = ledge.x - ledge.side * 0.3; f.y = ledge.y; f.vx = f.vy = 0; f.ledge = LEDGE_FRAMES; f.ledgeCooldown = LEDGE_COOLDOWN;
    f.invincible = Math.max(f.invincible, LEDGE_INVULN[Math.min(f.ledgeGrabs, LEDGE_INVULN.length - 1)]); f.ledgeGrabs++;
    f.jumps = 0; f.recovered = false; f.grounded = true; f.support = ledge.platform; f.attack = null; f.drop = 0; f.dropFrom = null;
    this.emit('ledge', f);
  }

  /** Grounded fighters on the same surface keep a small symmetric gap. Airborne fighters and rollers pass through. */
  private resolvePush() {
    const [a, b] = this.fighters;
    const solid = (f: Fighter) => f.grounded && f.respawn === 0 && f.stocks > 0 && !f.roll && f.heldBy === null && !f.hold && f.ledge === 0;
    if (!solid(a) || !solid(b) || Math.abs(a.y - b.y) > PUSH_HEIGHT) return;
    const min = this.def(a).push + this.def(b).push, gap = b.x - a.x, overlap = min - Math.abs(gap);
    if (overlap <= 0) return;
    const dir = gap === 0 ? (a.facing > 0 ? 1 : -1) : Math.sign(gap);   // b moves +dir, a moves -dir
    const room = (f: Fighter, d: number) => {
      const span = supportSpan(this.stage, f.support);
      if (!span) return overlap;
      return Math.max(0, d > 0 ? span.x1 - EDGE_MARGIN - f.x : f.x - (span.x0 + EDGE_MARGIN));
    };
    // Each fighter gives way by half, unless an edge leaves less room; the other then takes the remainder.
    let moveB = Math.min(overlap / 2, room(b, dir)), moveA = Math.min(overlap - moveB, room(a, -dir));
    moveB = Math.min(overlap - moveA, room(b, dir));
    a.x -= dir * moveA; b.x += dir * moveB;
  }

  // ---------------------------------------------------------------------------------------------------
  // Grabs, holds and throws
  // ---------------------------------------------------------------------------------------------------
  private holdActions(f: Fighter, def: FighterDef) {
    const h = f.hold!;
    if (f.attack) return;
    const g = latest(f.input, 'grab');
    if (g) { consume(f.input, g); discard(f.input, 'jump'); this.startThrow(f, throwDirection(f.facing, g)); return; }
    const p = latest(f.input, 'attack');
    if (p && h.pummels < PUMMEL_MAX && h.gap === 0) { consume(f.input, p); h.pummels++; h.gap = PUMMEL_GAP; this.startMove(f, def.moves.pummel); }
  }

  private startThrow(f: Fighter, dir: ThrowDir) { this.startMove(f, this.def(f).moves[throwMoveId(dir)]); }

  private updateHold(f: Fighter) {
    const def = this.def(f), h = f.hold!, t = this.fighters[h.target];
    if (t.heldBy !== f.slot || t.respawn > 0 || t.stocks <= 0) { this.endHold(f, false); return; }
    h.age++;
    if (h.gap > 0) h.gap--;
    const span = supportSpan(this.stage, f.support);
    t.x += clamp(holdPosition(f.x, f.facing, def.hold, span) - t.x, -HOLD_PULL, HOLD_PULL);
    t.y = f.y; t.vx = t.vy = 0; t.facing = -f.facing; t.grounded = true; t.support = f.support;
    // A fresh grab press inside the window breaks the hold. A button held from before the catch does not count.
    if (h.age <= TECH_FRAMES && pressedSince(t.input, 'grab', h.tick)) { this.tech(f, t); return; }
    const a = f.attack;
    if (a?.def.throwing) { if (a.age === a.def.throwing.release) this.releaseThrow(f, t, a); return; }
    if (a?.def.pummel) { if (a.age === PUMMEL_HIT) this.pummelHit(f, t, a); return; }
    if (h.age >= HOLD_MAX) this.startThrow(f, 'f');
  }

  private startHold(f: Fighter, t: Fighter) {
    f.attack = null; f.guarding = false;
    f.hold = { target: t.slot, age: 0, tick: this.tick, pummels: 0, gap: 0 };
    t.heldBy = f.slot; t.attack = null; t.guarding = false; t.roll = 0; t.busy = 0; t.vx = t.vy = 0;
    this.freeze = Math.max(this.freeze, CATCH_STOP);
    this.emit('catch', t);
  }

  /** Ends a hold and frees the captured fighter. `keepMove` leaves the captor's throw animation running. */
  private endHold(f: Fighter, keepMove: boolean) {
    const h = f.hold;
    if (!h) return;
    const t = this.fighters[h.target];
    if (t.heldBy === f.slot) t.heldBy = null;
    t.grabProtect = Math.max(t.grabProtect, GRAB_PROTECT);
    f.hold = null;
    if (!keepMove && f.attack && (f.attack.def.throwing || f.attack.def.pummel)) f.attack = null;
  }

  private releaseThrow(f: Fighter, t: Fighter, a: Attack) {
    const th = a.def.throwing!;
    this.endHold(f, true);
    this.applyHit(f, t, { damage: th.damage, launch: th.launch, stun: th.stun, stop: th.stop ?? 7, dirSign: f.facing, kind: 'throw' });
    a.hit = a.landed = true;
  }

  private pummelHit(f: Fighter, t: Fighter, a: Attack) {
    const buff = f.buff > 0 ? 1.25 : 1, dmg = (a.def.pummel ?? 1) * buff;
    t.damage = Math.min(999, t.damage + dmg); t.flash = 6; this.freeze = Math.max(this.freeze, 2);
    this.emit('pummel', t, dmg);
  }

  private tech(f: Fighter, t: Fighter) {
    discard(t.input, 'grab');
    this.endHold(f, false);
    this.separate(f, t, TECH_LAG, 'tech');
    this.emit('tech', t);
  }

  /** Pushes two fighters apart by a fixed distance each, inside their platforms, and leaves both recovering. */
  private separate(a: Fighter, b: Fighter, lag: number, kind: string) {
    const dir = Math.sign(b.x - a.x) || a.facing;
    for (const [f, d] of [[a, -dir], [b, dir]] as const) {
      const span = supportSpan(this.stage, f.support);
      const x = f.x + d * SEPARATE;
      f.x = span ? clamp(x, span.x0 + EDGE_MARGIN, span.x1 - EDGE_MARGIN) : x;
      f.attack = null; f.busy = lag; f.busyKind = kind; f.vx = f.vy = 0;
    }
    this.freeze = Math.max(this.freeze, 3);
  }

  // ---------------------------------------------------------------------------------------------------
  // Contact resolution
  // ---------------------------------------------------------------------------------------------------
  private resolveContacts() {
    // Snapshot every attack before applying anything: same-frame hits trade, and slot order never matters.
    const snapshot = this.fighters.map(f => ({ f, a: f.attack, stunned: f.stun > 0 }));
    const strikes: Strike[] = [], grabs: { f: Fighter; t: Fighter; a: Attack }[] = [];
    for (const { f, a, stunned } of snapshot) {
      if (!a || f.respawn || f.stocks <= 0 || stunned || f.heldBy !== null || a.diving) continue;
      const v = this.fighters[1 - f.slot];
      if (a.def.grab) {
        const g = a.def.grab;
        if (a.age >= g.from && a.age <= g.to && a.log.grab === undefined && f.grounded && canBeCaught(v) && catchConnects(f, g.box, v, this.def(v).hurt)) grabs.push({ f, t: v, a });
        continue;
      }
      const hurt = hurtboxOf(v);
      a.def.hits.forEach((w, i) => {
        if (a.age < w.from || a.age > w.to) return;
        const key = `${i}:${v.slot}`, last = a.log[key];
        if (last !== undefined && (w.rehit === undefined || a.age - last < w.rehit)) return;
        if (rectsOverlap(worldBox(w.box, f.x, f.y, f.facing), hurt)) strikes.push({ f, v, a, w, key });
      });
    }
    // A strike that connects on the grabber beats a normal grab. Two grabs connecting on each other break.
    const liveGrabs = grabs.filter(g => !strikes.some(s => s.f === g.t && s.v === g.f));
    const applied = new Set<string>();
    for (const s of strikes) {
      const pair = `${s.f.slot}>${s.v.slot}`;
      if (applied.has(pair)) continue;
      if (this.applyStrike(s)) applied.add(pair);
    }
    if (liveGrabs.length === 2) {
      for (const g of liveGrabs) { g.a.log.grab = g.a.age; g.a.hit = true; }
      this.separate(this.fighters[0], this.fighters[1], TECH_LAG, 'tech');
      for (const f of this.fighters) f.grabProtect = Math.max(f.grabProtect, 20);
      this.emit('throwBreak', this.fighters[0]);
    } else for (const g of liveGrabs) { g.a.log.grab = g.a.age; g.a.hit = true; this.startHold(g.f, g.t); }
  }

  /** Returns true if the strike connected (hit, blocked, countered or absorbed). */
  private applyStrike({ f, v, a, w, key }: Strike): boolean {
    if (v.invincible || v.respawn || v.stocks <= 0 || v.heldBy !== null) return false;
    const va = v.attack, cn = va?.def.counter;
    a.log[key] = a.age; a.hit = true;
    if (va && cn && !va.countered && va.age >= cn.from && va.age <= cn.to) {
      va.countered = true; this.emit('counter', v);
      this.applyHit(v, f, { damage: cn.damage, launch: cn.launch, stun: cn.stun, stop: cn.stop ?? 8, dirSign: Math.sign(f.x - v.x) || v.facing, kind: 'counter' });
      va.age = Math.max(va.age, va.duration - cn.after);
      return true;
    }
    if (v.guarding) { a.blocked = true; this.block(f, v, w.damage); return true; }
    const armor = va?.def.armor;
    if (armor && va && va.age >= armor.from && va.age <= armor.to && w.damage <= armor.limit) {
      // Armor absorbs the hit: damage lands, there is no flinch, and the armored move keeps going.
      v.damage = Math.min(999, v.damage + w.damage * (f.buff > 0 ? 1.25 : 1)); v.flash = 8;
      this.freeze = Math.max(this.freeze, w.stop ?? defaultStop(w.damage));
      a.landed = true; this.emit('armor', v, w.damage);
      return true;
    }
    a.landed = true;
    this.applyHit(f, v, { damage: w.damage, launch: w.launch, stun: w.stun, stunScale: w.stunScale, stop: w.stop, dirSign: w.dir === 'facing' ? f.facing : Math.sign(v.x - f.x) || f.facing, kind: a.kind });
    return true;
  }

  private block(attacker: Fighter, target: Fighter, damage: number) {
    target.shield -= damage * 2.4; target.vx = (Math.sign(target.x - attacker.x) || attacker.facing) * 0.08;
    this.freeze = Math.max(this.freeze, 3);
    this.emit('block', target);
    if (target.shield <= 0) this.breakShield(target);
  }

  /** Damage, launch, hitstun, hitstop and combo accounting. Launch speed = (base + damage * growth) / weight. */
  private applyHit(attacker: Fighter, victim: Fighter, h: HitSpec) {
    if (victim.hold) this.endHold(victim, false);
    if (victim.heldBy !== null) this.endHold(this.fighters[victim.heldBy], false);
    const buff = attacker.buff > 0 ? 1.25 : 1;
    // A hit continues a combo only if the defender has not yet regained the ability to act since the last one.
    // (A fighter's own combo is never cut by being hit: it ends when its target recovers, so trades stay symmetric.)
    const continued = victim.stun > 0 && attacker.combo > 0 && attacker.comboTarget === victim.slot;
    if (!continued) this.endCombo(attacker);
    // Anti-loop scaling: from the fourth hit of a combo on, damage and hitstun each lose 10% per hit (floor 50%).
    // Three-hit strings are untouched; long juggles run out of hitstun instead of looping.
    const scale = Math.max(0.5, 1 - 0.1 * Math.max(0, (continued ? attacker.combo + 1 : 1) - 3)), dealt = h.damage * buff * scale;
    victim.damage = Math.min(999, victim.damage + dealt);
    const mag = Math.min(MAX_LAUNCH, (h.launch.base + victim.damage * h.launch.growth) / this.def(victim).weight * (buff > 1 ? 1.1 : 1));
    const rad = h.launch.angle * Math.PI / 180;
    victim.vx = h.dirSign * Math.cos(rad) * mag; victim.vy = Math.sin(rad) * mag;
    victim.stun = Math.min(150, Math.max(8, Math.round(((h.stun ?? 11) + mag * (h.stunScale ?? 38)) * scale))); victim.di = victim.diY = 0;
    victim.attack = null; victim.guarding = false; victim.ledge = 0; victim.roll = 0; victim.busy = 0; victim.jabSequenceIndex = 0; victim.jabWindow = 0;
    victim.flash = 12;
    if (victim.vy > 0) { victim.grounded = false; victim.support = null; }
    this.freeze = Math.max(this.freeze, h.stop ?? defaultStop(h.damage));
    attacker.combo = continued ? attacker.combo + 1 : 1; attacker.comboDamage = continued ? attacker.comboDamage + dealt : dealt; attacker.comboTarget = victim.slot;
    this.emit('hit', victim, dealt, h.kind);
    if (attacker.combo >= 2) this.emit('combo', attacker, attacker.combo, String(Math.round(attacker.comboDamage)));
  }

  /** Legacy entry point: a generic hit from an original move category. Used by tests and debug tools. */
  hit(attacker: Fighter, target: Fighter, damage: number, force: number, kind: Move | 'projectile') {
    if (target.invincible || target.respawn || target.stocks <= 0) return;
    const direction = Math.sign(target.x - attacker.x) || attacker.facing;
    if (target.guarding) { this.block(attacker, target, damage); return; }
    const vertical = kind === 'upper' || kind === 'recovery';
    this.applyHit(attacker, target, { damage, launch: { angle: vertical ? 72 : 35, base: force * (vertical ? 1.154 : 1.177), growth: vertical ? 0.00335 : 0.00341 }, stop: kind === 'heavy' || kind === 'grab' ? 7 : 5, dirSign: direction, kind });
  }

  private endCombo(f: Fighter) {
    if (f.combo >= 2) this.emit('comboEnd', f, f.combo, String(Math.round(f.comboDamage)));
    f.combo = 0; f.comboDamage = 0; f.comboTarget = -1;
  }

  /** A confirmed combo ends when the defender regains the ability to act, or is out of play. */
  private updateCombos() {
    for (const f of this.fighters) {
      if (f.combo === 0) continue;
      const v = this.fighters[f.comboTarget];
      if (!v || (v.stun === 0 && v.heldBy === null) || v.respawn > 0 || v.stocks <= 0) this.endCombo(f);
    }
  }

  private breakShield(f: Fighter) { f.shield = 12; f.guarding = false; f.stun = 90; f.vy = 0.15; f.grounded = false; f.support = null; this.emit('break', f); }

  // ---------------------------------------------------------------------------------------------------
  // Projectiles, pickups, stock loss, match flow
  // ---------------------------------------------------------------------------------------------------
  private updateShots() {
    for (const s of this.shots) {
      const p = s.def, target = this.fighters[1 - s.owner], owner = this.fighters[s.owner];
      if (p.accel) s.vx = clamp(s.vx + Math.sign(s.vx || s.dir) * p.accel, -0.6, 0.6);
      s.vy -= p.gravity; s.life--;
      const x0 = s.x, y0 = s.y;
      let x1 = x0 + s.vx, y1 = y0 + s.vy;
      const wall = segmentHitsSolid(this.stage, x0, y0, x1, y1, 0.15, 0.15);
      if (wall) {
        if (p.solid === 'bounce' && wall.ny > 0 && s.bounces < 1) { s.bounces++; s.vy = Math.abs(s.vy) * 0.6 + 0.04; x1 = wall.x; y1 = wall.y + 1e-4; this.emit('bounce', owner); }
        else { s.x = wall.x; s.y = wall.y; s.life = 0; this.events.push({ type: 'shotBreak', x: s.x, y: s.y, slot: s.owner }); continue; }
      }
      s.x = x1; s.y = y1;
      if (target.respawn || target.invincible || target.stocks <= 0 || target.heldBy !== null) continue;
      const hit = segmentHitsRect(hurtboxOf(target), x0, y0, s.x, s.y, p.rx, p.ry);
      if (!hit) continue;
      s.life = 0;
      if (target.guarding) { this.block(owner, target, p.damage); continue; }
      this.applyHit(owner, target, { damage: p.damage, launch: p.launch, stun: p.stun, stop: p.stop, dirSign: Math.sign(s.vx) || s.dir, kind: 'projectile' });
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
    if (f.hold) this.endHold(f, false);
    if (f.heldBy !== null) this.endHold(this.fighters[f.heldBy], false);
    for (const other of this.fighters) if (other.comboTarget === f.slot) this.endCombo(other);
    this.endCombo(f);
    f.damage = 0; f.vx = f.vy = 0; f.stun = 0; f.attack = null; f.guarding = false; f.grounded = false; f.support = null;
    f.jumps = 0; f.recovered = false; f.buff = 0; f.roll = 0; f.ledge = 0; f.ledgeGrabs = 0; f.ledgeCooldown = 0; f.busy = 0; f.grabProtect = 0;
    f.jabSequenceIndex = 0; f.jabWindow = 0; f.drop = 0; f.dropFrom = null; f.di = f.diY = 0;
    f.shield = 100; f.respawn = 70;
    clearInputs(f.input);
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

  // ---------------------------------------------------------------------------------------------------
  // Practice helpers
  // ---------------------------------------------------------------------------------------------------
  /** Turns a fighter toward a direction when it is free to turn (CPU and training use this; humans turn via input). */
  faceToward(f: Fighter, dir: number) {
    if (dir && !f.attack && !f.stun && !f.roll && f.busy === 0 && !f.hold && f.heldBy === null && f.respawn === 0) f.facing = Math.sign(dir);
  }
  setDamage(slot: number, percent: number) { this.fighters[slot].damage = clamp(percent, 0, 999); }
  /** Puts both fighters back at their starting marks, cleanly: no holds, hitstun, moves or buffered presses. */
  resetPositions() {
    for (const f of this.fighters) {
      if (f.hold) this.endHold(f, false);
      const x = f.slot ? 4 : -4;
      Object.assign(f, { x, y: 0, prevX: x, prevY: 0, vx: 0, vy: 0, facing: f.slot ? -1 : 1, grounded: true, support: 'main', jumps: 0, recovered: false, stun: 0, invincible: 0, respawn: 0,
        guarding: false, attack: null, roll: 0, ledge: 0, busy: 0, heldBy: null, grabProtect: 0, drop: 0, dropFrom: null, di: 0, diY: 0, jabSequenceIndex: 0, jabWindow: 0, combo: 0, comboDamage: 0, comboTarget: -1 });
      clearInputs(f.input);
    }
    this.shots = []; this.freeze = 0;
  }

  /**
   * Gameplay state before the next `step`. Definitions are reattached on load, so this is safe to keep
   * and restore across rollback. Presentation (audio, particles, camera) is not part of it.
   */
  save(): SimSnapshot { return buildSnapshot(this, { rng: this.rng, serial: this.serial, itemClock: this.itemClock }); }
  load(snap: SimSnapshot) {
    const hidden = applySnapshot(this, snap);
    this.rng = hidden.rng; this.serial = hidden.serial; this.itemClock = hidden.itemClock;
  }
  /** Checksum of the full gameplay state, not just positions and damage. */
  hashState(): string { return hashSnapshot(this.save()); }
}
