import { isHitWindowActive } from './moveTiming';
import {
  ATTACK_BUFFER_FRAMES,
  COMBO_DAMAGE_CAP_RATIO,
  COMBO_HIT_CAP,
  COMBO_RESET_FRAMES,
  COMBO_SCALING,
  DASH_DOUBLE_TAP_WINDOW_FRAMES,
  GRAB_ESCAPE_WINDOW_FRAMES,
  GRAVITY,
  GROUND_Y,
  GUARD_BREAK_REFILL,
  GUARD_BREAK_STUN_FRAMES,
  GUARD_REGEN_DELAY_FRAMES,
  GUARD_REGEN_PER_FRAME,
  HYPE_GAIN_ON_DEAL_RATIO,
  HYPE_GAIN_ON_TAKE_RATIO,
  KNOCKDOWN_FRAMES,
  MAX_GUARD,
  MAX_HYPE,
  PUSHBOX_SEPARATION_PADDING,
  ROUND_TIME_FRAMES,
  STAGE_LEFT_WALL,
  STAGE_RIGHT_WALL,
  WAKEUP_INVULN_FRAMES,
} from './constants';
import {
  createFighterRuntime,
  hurtboxFor,
  isActivelyBlocking,
  isAirborne,
  isGrounded,
  resetFighterForRound,
  GRABABLE_STATES,
  type FighterRuntime,
} from './FighterRuntime';
import { localBoxToWorld, boxesOverlap, pushboxOverlap } from './collision';
import { resolveDefense } from './defense';
import {
  spawnProjectile,
  stepProjectile,
  projectileSweptWorldBox,
  isProjectileArmed,
  type ProjectileInstance,
} from './Projectile';
import {
  PICKUP_LIFETIME_FRAMES,
  applyPickupEffect,
  rollNextSpawnFrame,
  rollPickupKind,
  rollPickupX,
  type PickupInstance,
} from './Pickups';
import { Rng } from './rng';
import type { SimEvent, PlayerSlot } from './events';
import type { ResolvedAction } from './ActionQueue';
import type { CharacterDef, HitEffect, MoveHitWindow, MoveKind, PlayerFrameInput } from './types';

const CHIP_DAMAGE_RATIO = 0.12;

export interface CombatSimOptions {
  p1Def: CharacterDef;
  p2Def: CharacterDef;
  powerupsEnabled: boolean;
  seed: number;
}

export interface RoundOutcome {
  winner: PlayerSlot | 'draw';
  reason: 'ko' | 'timeout' | 'draw';
}

interface StrikeCandidate {
  kind: 'strike';
  attacker: PlayerSlot;
  defender: PlayerSlot;
  windowIndex: number;
  effect: HitEffect;
  isSuper: boolean;
}
interface GrabCandidate {
  kind: 'grab';
  attacker: PlayerSlot;
  defender: PlayerSlot;
  effect: HitEffect;
}
interface ProjectileCandidate {
  kind: 'projectile';
  attacker: PlayerSlot;
  defender: PlayerSlot;
  proj: ProjectileInstance;
  effect: HitEffect;
}
interface TargetedCandidate {
  kind: 'targeted';
  attacker: PlayerSlot;
  defender: PlayerSlot;
  effect: HitEffect;
}
type Candidate = StrikeCandidate | GrabCandidate | ProjectileCandidate | TargetedCandidate;

export class CombatSim {
  p1: FighterRuntime;
  p2: FighterRuntime;
  projectiles: ProjectileInstance[] = [];
  pickup: PickupInstance | null = null;
  nextPickupFrame = 0;
  clockFrames = ROUND_TIME_FRAMES;
  frameCount = 0;
  freezeFrames = 0;
  ended = false;
  result: RoundOutcome | null = null;
  powerupsEnabled: boolean;
  rng: Rng;
  private pickupsCollectedEver = 0;

  constructor(opts: CombatSimOptions) {
    this.p1 = createFighterRuntime(opts.p1Def, 150, 1);
    this.p2 = createFighterRuntime(opts.p2Def, BASE_ARENA_RIGHT_START, -1);
    this.powerupsEnabled = opts.powerupsEnabled;
    this.rng = new Rng(opts.seed);
    this.nextPickupFrame = rollNextSpawnFrame(this.rng, 0, true);
  }

  resetRound(): void {
    resetFighterForRound(this.p1, 150, 1);
    resetFighterForRound(this.p2, BASE_ARENA_RIGHT_START, -1);
    this.projectiles = [];
    this.pickup = null;
    this.nextPickupFrame = rollNextSpawnFrame(this.rng, 0, true);
    this.clockFrames = ROUND_TIME_FRAMES;
    this.frameCount = 0;
    this.freezeFrames = 0;
    this.ended = false;
    this.result = null;
  }

  step(p1Input: PlayerFrameInput, p2Input: PlayerFrameInput): SimEvent[] {
    const events: SimEvent[] = [];
    if (this.ended) return events;

    if (this.freezeFrames > 0) {
      this.freezeFrames--;
      // Impact freezes combat, but the round clock still advances at 60 Hz.
      this.tickClock(events);
      // Hit-stop freezes movement, move timelines, and damage processing, but a short
      // attack request made during the freeze must still be buffered so it isn't lost;
      // it executes at the fighter's first valid opportunity once frozen state ends.
      this.p1.queue.push(p1Input, this.isSuperAvailable(this.p1), true);
      this.p2.queue.push(p2Input, this.isSuperAvailable(this.p2), true);
      return events;
    }

    this.frameCount++;

    const p1PrevX = this.p1.x;
    const p2PrevX = this.p2.x;

    this.processFighter(this.p1, this.p2, p1Input, 'p1', p2PrevX, events);
    this.processFighter(this.p2, this.p1, p2Input, 'p2', p1PrevX, events);

    this.integratePhysics(this.p1);
    this.integratePhysics(this.p2);
    this.resolvePushboxes();

    this.updateProjectiles();
    this.updateTargetedStrikeTimers();

    const candidates = this.collectCandidates();
    this.resolveCandidates(candidates, events);

    this.tickBuffsAndRegen(this.p1);
    this.tickBuffsAndRegen(this.p2);

    if (this.powerupsEnabled) this.updatePickups(events);

    this.checkKO(events);
    if (!this.ended) this.tickClock(events);

    return events;
  }

  // ---------------------------------------------------------------------
  // Per-fighter state machine
  // ---------------------------------------------------------------------

  private processFighter(
    self: FighterRuntime,
    other: FighterRuntime,
    input: PlayerFrameInput,
    slot: PlayerSlot,
    otherPrevX: number,
    events: SimEvent[],
  ): void {
    self.queue.push(input, this.isSuperAvailable(self));

    if (self.cooldowns.special > 0) self.cooldowns.special--;
    if (self.cooldowns.downSpecial > 0) self.cooldowns.downSpecial--;
    if (self.cooldowns.grab > 0) self.cooldowns.grab--;
    if (self.cooldowns.super > 0) self.cooldowns.super--;

    // Genuine double-tap detection: press -> release -> press (same direction) within
    // DASH_DOUBLE_TAP_WINDOW_FRAMES. Driven by raw left/right edges rather than held
    // state, so holding a direction can never itself look like a tap. Runs every frame
    // regardless of state so a tap started before a stun/attack still resolves correctly.
    {
      const leftEdge = input.left && !self.prevLeftHeld;
      const rightEdge = input.right && !self.prevRightHeld;
      const leftReleaseEdge = !input.left && self.prevLeftHeld;
      const rightReleaseEdge = !input.right && self.prevRightHeld;
      self.prevLeftHeld = input.left;
      self.prevRightHeld = input.right;

      if (self.tapPendingTimer > 0) {
        self.tapPendingTimer--;
        if (self.tapPendingTimer === 0) self.tapPendingDir = 0;
      }

      self.lastDirTap = 0;
      if (leftEdge && self.tapPendingDir === -1) {
        self.lastDirTap = -1;
        self.tapPendingDir = 0;
        self.tapPendingTimer = 0;
      } else if (rightEdge && self.tapPendingDir === 1) {
        self.lastDirTap = 1;
        self.tapPendingDir = 0;
        self.tapPendingTimer = 0;
      } else if (leftReleaseEdge) {
        self.tapPendingDir = -1;
        self.tapPendingTimer = DASH_DOUBLE_TAP_WINDOW_FRAMES;
      } else if (rightReleaseEdge) {
        self.tapPendingDir = 1;
        self.tapPendingTimer = DASH_DOUBLE_TAP_WINDOW_FRAMES;
      }
    }

    if (self.comboResetTimer > 0) {
      self.comboResetTimer--;
      if (self.comboResetTimer === 0) {
        self.comboCount = 0;
        self.comboDamage = 0;
      }
    }

    switch (self.state) {
      case 'intro':
        self.stateTimer--;
        if (self.stateTimer <= 0) {
          self.state = 'idle';
          self.introDone = true;
        }
        return;
      case 'ko':
      case 'victory':
        return;
      case 'knockdown':
        self.stateTimer--;
        if (self.stateTimer <= 0) {
          self.state = 'wakeup';
          self.stateTimer = WAKEUP_INVULN_FRAMES;
          self.wakeupInvuln = WAKEUP_INVULN_FRAMES;
        }
        return;
      case 'wakeup':
        self.wakeupInvuln = Math.max(0, self.wakeupInvuln - 1);
        self.stateTimer--;
        if (self.stateTimer <= 0) self.state = 'idle';
        return;
      case 'hitstun':
      case 'blockstun':
      case 'guardbreak':
        self.stateTimer--;
        if (self.stateTimer <= 0) self.state = isGrounded(self) ? 'idle' : 'jump';
        return;
      case 'grabbed':
        if (input.grabPressed && self.grabEscapeWindow > 0) {
          self.pendingThrow = null;
          self.grabEscapeWindow = 0;
          self.state = 'idle';
          self.x += slot === 'p1' ? -14 : 14;
          events.push({ type: 'grabEscape', escaper: slot });
          return;
        }
        self.grabEscapeWindow--;
        if (self.grabEscapeWindow <= 0) {
          this.completeThrow(self, other, slot, events);
        }
        return;
      case 'attack':
        this.advanceActiveMove(self, other, slot, events);
        return;
      default:
        break;
    }

    // Free states: idle / walk / dash / jump / crouch
    const grounded = isGrounded(self);
    if (grounded) {
      const targetFacing = other.x >= self.x ? 1 : -1;
      self.facing = targetFacing as 1 | -1;
    }

    let moveDir: -1 | 0 | 1 = 0;
    if (input.left && !input.right) moveDir = -1;
    else if (input.right && !input.left) moveDir = 1;

    const jumpEdge = false; // computed below via edge detection using up state transitions
    void jumpEdge;
    void otherPrevX;

    if (grounded) {
      // Jump: up pressed as an edge and down isn't held (crouch wins on simultaneous press).
      const upIsNewPress = input.up && !this.prevUp(self);
      this.setPrevUp(self, input.up);
      if (upIsNewPress && !input.down && self.dashFramesLeft === 0) {
        self.vy = self.def.jumpVelocity;
        self.state = 'jump';
        events.push({ type: 'jump', who: slot });
      } else if (input.down) {
        self.state = 'crouch';
        self.vx = 0;
      } else if (self.dashFramesLeft > 0) {
        self.dashFramesLeft--;
        if (self.dashFramesLeft === 0) self.state = moveDir !== 0 ? 'walk' : 'idle';
      } else {
        const forward = self.facing === 1 ? 1 : -1;
        if (moveDir !== 0 && moveDir === (forward as number) && self.lastDirTap === moveDir) {
          self.state = 'dash';
          self.dashFramesLeft = 10;
          self.vx = self.def.dashSpeed * moveDir * self.modifiers.speedMult;
          self.lastDirTap = 0;
          events.push({ type: 'dash', who: slot });
        } else {
          self.state = moveDir !== 0 ? 'walk' : 'idle';
          self.vx = moveDir * self.def.walkSpeed * self.modifiers.speedMult;
        }
      }
    } else {
      self.vx = moveDir * self.def.walkSpeed * 0.7 * self.modifiers.speedMult;
    }

    if (grounded && input.blockHeld) {
      // Standing block if not also holding down; crouch-block (keeps 'crouch' state so
      // resolveDefense can tell the two apart) otherwise.
      self.blocking = true;
      self.state = input.down ? 'crouch' : 'block';
      self.vx = 0;
    } else {
      self.blocking = false;
    }

    // Free states tick the basic-chain window down while waiting for the next input.
    if (self.chainWindow > 0) {
      self.chainWindow--;
      if (self.chainWindow === 0) self.chainIndex = 0;
    }

    // Action queue resolution (attacks / grab / super chord)
    const grabableSelf = grounded && (self.state === 'idle' || self.state === 'walk' || self.state === 'crouch' || self.state === 'block' || self.state === 'dash');
    if (grabableSelf || !grounded) {
      const action = self.queue.consumeReady();
      if (action) this.tryStartMove(self, other, action, grounded, events, slot);
    }
  }

  private prevUpMap = new WeakMap<FighterRuntime, boolean>();
  private prevUp(f: FighterRuntime): boolean {
    return this.prevUpMap.get(f) ?? false;
  }
  private setPrevUp(f: FighterRuntime, v: boolean): void {
    this.prevUpMap.set(f, v);
  }

  private isSuperAvailable(f: FighterRuntime): boolean {
    return f.hype >= f.def.moves.super.meterCost && f.cooldowns.super === 0;
  }

  private tryStartMove(
    self: FighterRuntime,
    other: FighterRuntime,
    action: ResolvedAction,
    grounded: boolean,
    events: SimEvent[],
    slot: PlayerSlot,
  ): void {
    let kind: MoveKind | null = null;
    let isSuper = false;

    if (action.type === 'chord') {
      if (this.isSuperAvailable(self)) {
        kind = 'super';
        isSuper = true;
      } else {
        kind = self.chainWindow > 0 && self.chainIndex < 3 ? (['basic1', 'basic2', 'basic3'] as MoveKind[])[self.chainIndex] : 'basic1';
      }
    } else if (action.type === 'grab') {
      if (grounded && self.cooldowns.grab === 0) kind = 'grab';
      else return;
    } else if (action.type === 'basic') {
      if (!grounded) kind = 'jumpBasic';
      else {
        const forward = self.facing === 1 ? action.right : action.left;
        if (forward) kind = 'forwardBasic';
        else if (self.state === 'crouch' || action.down) kind = 'crouchBasic';
        else if (self.chainWindow > 0 && self.chainIndex < 3) kind = (['basic1', 'basic2', 'basic3'] as MoveKind[])[self.chainIndex];
        else kind = 'basic1';
      }
    } else if (action.type === 'special') {
      const wantsDown = self.state === 'crouch' || action.down;
      if (wantsDown) {
        if (self.cooldowns.downSpecial === 0) kind = 'downSpecial';
        else return;
      } else {
        if (self.cooldowns.special === 0) kind = 'special';
        else return;
      }
    }

    if (!kind) return;
    const def = self.def.moves[kind];
    if (!def) return;

    self.activeMove = { def, frame: 0, lastHitFrame: new Map(), isSuper, projectileSpawned: false };
    self.state = 'attack';
    self.vx = def.lunge ? def.lunge.speed * self.facing : 0;
    if (kind === 'basic1' || kind === 'basic2' || kind === 'basic3') {
      self.chainIndex = (kind === 'basic1' ? 1 : kind === 'basic2' ? 2 : 3) as 0 | 1 | 2 | 3;
      self.chainWindow = 0;
    } else {
      self.chainIndex = 0;
      self.chainWindow = 0;
    }
    if (kind === 'special') self.cooldowns.special = def.cooldown;
    if (kind === 'downSpecial') self.cooldowns.downSpecial = def.cooldown;
    if (kind === 'grab') self.cooldowns.grab = def.cooldown;
    if (kind === 'super') {
      self.hype -= def.meterCost;
      self.cooldowns.super = def.cooldown;
    }
    if (def.targetedStrike) {
      const worldX = self.x + def.targetedStrike.offset.x * self.facing;
      self.pendingTargetedStrike = {
        framesLeft: def.targetedStrike.delayFrames,
        activeFramesLeft: 0,
        worldX,
        def: def.targetedStrike,
        hasHit: false,
      };
      events.push({ type: 'targetedStrikeMarked', who: slot, x: worldX, delayFrames: def.targetedStrike.delayFrames });
    }
    // Projectiles do not launch here: they release on their own authored frame once the
    // move is actually running (see advanceActiveMove), so interrupting startup correctly
    // prevents an unlaunched projectile from ever appearing.
    events.push({ type: 'moveStarted', who: slot, moveId: def.id, kind: def.kind, isSuper });
  }

  private advanceActiveMove(self: FighterRuntime, other: FighterRuntime, slot: PlayerSlot, events: SimEvent[]): void {
    const move = self.activeMove;
    if (!move) {
      self.state = isGrounded(self) ? 'idle' : 'jump';
      return;
    }
    move.frame++;
    if (move.def.lunge) {
      self.vx = move.frame < move.def.lunge.frames ? move.def.lunge.speed * self.facing : 0;
    }
    if (move.def.projectile && !move.projectileSpawned) {
      // A fighter's sim x/y is its ground anchor (y=0 grounded, negative airborne); the
      // projectile's own spawnOffset is applied exactly once, inside spawnProjectile.
      const releaseFrame = move.def.projectile.releaseFrame ?? move.def.startup;
      if (move.frame >= releaseFrame) {
        move.projectileSpawned = true;
        const activeCount = this.projectiles.filter((p) => p.ownerSlot === slot && p.def === move.def.projectile).length;
        if (activeCount < move.def.projectile.maxActiveInstances) {
          this.projectiles.push(spawnProjectile(slot, move.def.id, move.def.projectile, self.x, self.y, self.facing));
          events.push({ type: 'projectileReleased', who: slot, moveId: move.def.id });
        }
      }
    }
    const total = move.def.totalFrames;
    if (move.frame >= total) {
      self.activeMove = null;
      self.state = isGrounded(self) ? 'idle' : 'jump';
      if (move.def.kind === 'basic1' || move.def.kind === 'basic2' || move.def.kind === 'basic3') {
        self.chainWindow = 14;
      }
    }
    void other;
    void slot;
    void events;
  }

  // ---------------------------------------------------------------------
  // Physics
  // ---------------------------------------------------------------------

  private integratePhysics(f: FighterRuntime): void {
    if (f.state === 'attack' && f.activeMove) {
      // committed attacks: no directional drive, but knockback drift (vx from
      // being hit is handled on the other fighter, not here) still applies to y.
    }
    if (!isGrounded(f) || f.vy !== 0) {
      f.vy += GRAVITY;
      f.y += f.vy;
      if (f.y >= 0) {
        f.y = 0;
        f.vy = 0;
        if (f.state === 'jump') f.state = 'idle';
      }
    }
    if (f.state !== 'block' && f.state !== 'crouch') {
      f.x += f.vx;
    }
    // Gradually settle knockback drift from stunned states
    if (f.state === 'hitstun' || f.state === 'blockstun' || f.state === 'knockdown' || f.state === 'guardbreak') {
      f.vx *= 0.85;
      f.x += 0; // already added above; drift decays for next frame
    }
    f.x = Math.max(STAGE_LEFT_WALL + 10, Math.min(STAGE_RIGHT_WALL - 10, f.x));
  }

  private resolvePushboxes(): void {
    const a = this.p1;
    const b = this.p2;
    if (!isGrounded(a) || !isGrounded(b)) return;
    if (a.state === 'knockdown' || b.state === 'knockdown') return;
    const rawOverlap = pushboxOverlap(a.x, a.def.width, b.x, b.def.width);
    if (rawOverlap > 0) {
      const overlap = rawOverlap + PUSHBOX_SEPARATION_PADDING;
      const dir = a.x <= b.x ? -1 : 1;
      a.x += (dir * overlap) / 2;
      b.x -= (dir * overlap) / 2;
      a.x = Math.max(STAGE_LEFT_WALL + 10, Math.min(STAGE_RIGHT_WALL - 10, a.x));
      b.x = Math.max(STAGE_LEFT_WALL + 10, Math.min(STAGE_RIGHT_WALL - 10, b.x));
    }
  }

  // ---------------------------------------------------------------------
  // Projectiles & targeted strikes
  // ---------------------------------------------------------------------

  private updateProjectiles(): void {
    for (const p of this.projectiles) stepProjectile(p);
    this.projectiles = this.projectiles.filter(
      (p) => p.age < p.def.life && p.x > STAGE_LEFT_WALL - 20 && p.x < STAGE_RIGHT_WALL + 20 && !p.hasHit,
    );
  }

  private updateTargetedStrikeTimers(): void {
    for (const f of [this.p1, this.p2]) {
      const t = f.pendingTargetedStrike;
      if (!t) continue;
      if (t.framesLeft > 0) {
        t.framesLeft--;
        if (t.framesLeft === 0) t.activeFramesLeft = t.def.activeFrames;
      } else if (t.activeFramesLeft > 0) {
        t.activeFramesLeft--;
        if (t.activeFramesLeft === 0) f.pendingTargetedStrike = null;
      }
    }
  }

  // ---------------------------------------------------------------------
  // Hit collection & resolution
  // ---------------------------------------------------------------------

  private collectCandidates(): Candidate[] {
    const out: Candidate[] = [];
    this.collectFighterCandidates(this.p1, this.p2, 'p1', 'p2', out);
    this.collectFighterCandidates(this.p2, this.p1, 'p2', 'p1', out);

    for (const p of this.projectiles) {
      if (p.hasHit || !isProjectileArmed(p)) continue;
      const targetSlot: PlayerSlot = p.ownerSlot === 'p1' ? 'p2' : 'p1';
      const target = targetSlot === 'p1' ? this.p1 : this.p2;
      if (target.wakeupInvuln > 0) continue;
      const pBox = projectileSweptWorldBox(p);
      const hBox = localBoxToWorld(hurtboxFor(target), target.x, target.y, 1);
      if (boxesOverlap(pBox, hBox)) {
        out.push({ kind: 'projectile', attacker: p.ownerSlot, defender: targetSlot, proj: p, effect: p.def.effect });
      }
    }

    for (const [slot, f] of [['p1', this.p1] as const, ['p2', this.p2] as const]) {
      const t = f.pendingTargetedStrike;
      if (!t || t.activeFramesLeft <= 0 || t.hasHit) continue;
      const defenderSlot: PlayerSlot = slot === 'p1' ? 'p2' : 'p1';
      const defender = defenderSlot === 'p1' ? this.p1 : this.p2;
      if (defender.wakeupInvuln > 0) continue;
      const box = { left: t.worldX - t.def.markerRadius, right: t.worldX + t.def.markerRadius, top: -1000, bottom: 0 };
      const hBox = localBoxToWorld(hurtboxFor(defender), defender.x, defender.y, 1);
      if (boxesOverlap(box, hBox)) {
        out.push({ kind: 'targeted', attacker: slot, defender: defenderSlot, effect: t.def.effect });
      }
    }
    return out;
  }

  private collectFighterCandidates(self: FighterRuntime, other: FighterRuntime, selfSlot: PlayerSlot, otherSlot: PlayerSlot, out: Candidate[]): void {
    if (self.state !== 'attack' || !self.activeMove) return;
    const move = self.activeMove;
    if (other.wakeupInvuln > 0) return;
    const otherHurtbox = localBoxToWorld(hurtboxFor(other), other.x, other.y, 1);

    if (move.def.isGrab) {
      if (move.def.hits.length === 0) return;
      const hit = move.def.hits[0];
      const active = isHitWindowActive(hit, move.frame);
      if (!active || move.lastHitFrame.has(0)) return;
      if (!GRABABLE_STATES.includes(other.state) || !isGrounded(other)) return;
      const selfBox = localBoxToWorld(hit.box, self.x, self.y, self.facing);
      if (!boxesOverlap(selfBox, otherHurtbox)) return;
      out.push({ kind: 'grab', attacker: selfSlot, defender: otherSlot, effect: hit.effect });
      return;
    }

    move.def.hits.forEach((hit: MoveHitWindow, idx: number) => {
      const active = isHitWindowActive(hit, move.frame);
      if (!active) return;
      const last = move.lastHitFrame.get(idx);
      if (last !== undefined) {
        if (hit.reHitInterval === undefined) return;
        if (move.frame - last < hit.reHitInterval) return;
      }
      const selfBox = localBoxToWorld(hit.box, self.x, self.y, self.facing);
      if (!boxesOverlap(selfBox, otherHurtbox)) return;
      out.push({ kind: 'strike', attacker: selfSlot, defender: otherSlot, windowIndex: idx, effect: hit.effect, isSuper: move.isSuper });
    });
  }

  private resolveCandidates(candidates: Candidate[], events: SimEvent[]): void {
    const grabs = candidates.filter((c): c is GrabCandidate => c.kind === 'grab');
    const p1Grab = grabs.find((g) => g.attacker === 'p1');
    const p2Grab = grabs.find((g) => g.attacker === 'p2');
    let skipGrabs = false;
    if (p1Grab && p2Grab) {
      skipGrabs = true;
      events.push({ type: 'throwBreak' });
      this.bounceApart();
      this.markGrabResolved(this.p1);
      this.markGrabResolved(this.p2);
    }

    for (const c of candidates) {
      if (c.kind === 'grab') {
        if (skipGrabs) continue;
        this.applyGrabConnect(c, events);
      } else if (c.kind === 'strike') {
        this.applyStrikeCandidate(c, events);
      } else if (c.kind === 'projectile') {
        this.applyProjectileCandidate(c, events);
      } else if (c.kind === 'targeted') {
        this.applyTargetedCandidate(c, events);
      }
    }
  }

  private markGrabResolved(f: FighterRuntime): void {
    if (f.activeMove) f.activeMove.lastHitFrame.set(0, f.activeMove.frame);
  }

  private bounceApart(): void {
    const dir = this.p1.x <= this.p2.x ? -1 : 1;
    this.p1.x += dir * 10;
    this.p2.x -= dir * 10;
  }

  private fighter(slot: PlayerSlot): FighterRuntime {
    return slot === 'p1' ? this.p1 : this.p2;
  }

  private isCounterArmed(f: FighterRuntime): boolean {
    if (f.state !== 'attack' || !f.activeMove || !f.activeMove.def.isCounter) return false;
    const w = f.activeMove.def.counterWindow;
    if (!w) return false;
    return f.activeMove.frame >= w.start && f.activeMove.frame <= w.end;
  }

  private applyStrikeCandidate(c: StrikeCandidate, events: SimEvent[]): void {
    const attacker = this.fighter(c.attacker);
    const defender = this.fighter(c.defender);
    if (attacker.activeMove) attacker.activeMove.lastHitFrame.set(c.windowIndex, attacker.activeMove.frame);

    if (this.isCounterArmed(defender)) {
      const riposte = defender.activeMove!.def.counterEffect;
      if (riposte) {
        this.dealDamage(defender, attacker, riposte, false, events, c.defender, c.attacker);
        events.push({ type: 'counterTriggered', who: c.defender });
      }
      return;
    }

    const airborne = isAirborne(defender);
    const crouching = defender.state === 'crouch';
    const outcome = resolveDefense(crouching, airborne, isActivelyBlocking(defender), c.effect.height);
    if (outcome === 'evaded') return;
    if (outcome === 'blocked') {
      this.applyBlockedHit(attacker, defender, c.effect, events, c.attacker, c.defender);
    } else {
      this.dealDamage(attacker, defender, c.effect, true, events, c.attacker, c.defender);
    }
  }

  private applyProjectileCandidate(c: ProjectileCandidate, events: SimEvent[]): void {
    const attacker = this.fighter(c.attacker);
    const defender = this.fighter(c.defender);
    c.proj.hasHit = true;
    const airborne = isAirborne(defender);
    const crouching = defender.state === 'crouch';
    const outcome = resolveDefense(crouching, airborne, isActivelyBlocking(defender), c.effect.height);
    if (outcome === 'evaded') return;
    if (outcome === 'blocked') this.applyBlockedHit(attacker, defender, c.effect, events, c.attacker, c.defender);
    else this.dealDamage(attacker, defender, c.effect, true, events, c.attacker, c.defender);
  }

  private applyTargetedCandidate(c: TargetedCandidate, events: SimEvent[]): void {
    const attacker = this.fighter(c.attacker);
    const defender = this.fighter(c.defender);
    attacker.pendingTargetedStrike!.hasHit = true;
    events.push({ type: 'targetedStrikeLanded', who: c.attacker, x: attacker.pendingTargetedStrike!.worldX });
    const airborne = isAirborne(defender);
    const crouching = defender.state === 'crouch';
    const outcome = resolveDefense(crouching, airborne, isActivelyBlocking(defender), c.effect.height);
    if (outcome === 'evaded') return;
    if (outcome === 'blocked') this.applyBlockedHit(attacker, defender, c.effect, events, c.attacker, c.defender);
    else this.dealDamage(attacker, defender, c.effect, true, events, c.attacker, c.defender);
  }

  /** A grab connecting only catches the opponent; damage is deferred until the escape window expires unescaped (see completeThrow). */
  private applyGrabConnect(c: GrabCandidate, events: SimEvent[]): void {
    const attacker = this.fighter(c.attacker);
    const defender = this.fighter(c.defender);
    if (attacker.activeMove) attacker.activeMove.lastHitFrame.set(0, attacker.activeMove.frame);
    defender.state = 'grabbed';
    defender.vx = 0;
    defender.grabEscapeWindow = GRAB_ESCAPE_WINDOW_FRAMES;
    defender.pendingThrow = { effect: c.effect, attackerFacing: attacker.facing, attackerSlot: c.attacker };
    this.freezeFrames = Math.max(this.freezeFrames, Math.ceil(c.effect.hitstopFrames * 0.5));
  }

  /** Called when a grabbed fighter's escape window expires without an escape press: the throw actually lands. */
  private completeThrow(defender: FighterRuntime, attacker: FighterRuntime, defenderSlot: PlayerSlot, events: SimEvent[]): void {
    const pending = defender.pendingThrow;
    defender.pendingThrow = null;
    if (!pending) {
      defender.state = 'idle';
      return;
    }
    const attackerSlot = pending.attackerSlot;
    const dmg = pending.effect.damage * attacker.modifiers.damageMult;
    defender.health = Math.max(0, defender.health - dmg);
    defender.vx = pending.effect.knockback.x * (pending.attackerFacing as number);
    defender.state = 'knockdown';
    defender.stateTimer = KNOCKDOWN_FRAMES;
    defender.comboCount = 0;
    defender.comboDamage = 0;
    defender.comboResetTimer = 0;
    attacker.hype = Math.min(MAX_HYPE, attacker.hype + dmg * HYPE_GAIN_ON_DEAL_RATIO);
    defender.hype = Math.min(MAX_HYPE, defender.hype + dmg * HYPE_GAIN_ON_TAKE_RATIO);
    this.freezeFrames = Math.max(this.freezeFrames, pending.effect.hitstopFrames);
    events.push({ type: 'grabConnect', attacker: attackerSlot, defender: defenderSlot, damage: dmg });
  }

  private applyBlockedHit(attacker: FighterRuntime, defender: FighterRuntime, effect: HitEffect, events: SimEvent[], attackerSlot: PlayerSlot, defenderSlot: PlayerSlot): void {
    const chip = effect.damage * CHIP_DAMAGE_RATIO * attacker.modifiers.damageMult;
    defender.health = Math.max(0, defender.health - chip);
    defender.guard = Math.max(0, defender.guard - effect.guardDamage);
    defender.guardRegenDelay = GUARD_REGEN_DELAY_FRAMES;
    let guardBreak = false;
    if (defender.guard <= 0) {
      guardBreak = true;
      defender.state = 'guardbreak';
      defender.stateTimer = GUARD_BREAK_STUN_FRAMES;
      defender.guard = GUARD_BREAK_REFILL;
    } else {
      defender.state = 'blockstun';
      defender.stateTimer = effect.blockstunFrames;
    }
    defender.vx = effect.knockback.x * 0.3 * (attacker.facing as number);
    attacker.hype = Math.min(MAX_HYPE, attacker.hype + chip * HYPE_GAIN_ON_DEAL_RATIO);
    defender.hype = Math.min(MAX_HYPE, defender.hype + chip * HYPE_GAIN_ON_TAKE_RATIO);
    this.freezeFrames = Math.max(this.freezeFrames, Math.ceil(effect.hitstopFrames * 0.5));
    events.push({ type: 'blocked', attacker: attackerSlot, defender: defenderSlot, damage: chip, hitstop: effect.hitstopFrames, guardBreak });
  }

  private dealDamage(
    attacker: FighterRuntime,
    defender: FighterRuntime,
    effect: HitEffect,
    countsForCombo: boolean,
    events: SimEvent[],
    attackerSlot: PlayerSlot,
    defenderSlot: PlayerSlot,
  ): void {
    let scale = 1;
    let comboHits = 0;
    if (countsForCombo) {
      const idx = Math.min(defender.comboCount, COMBO_SCALING.length - 1);
      scale = COMBO_SCALING[idx];
      defender.comboCount++;
      comboHits = defender.comboCount;
      defender.comboResetTimer = COMBO_RESET_FRAMES;
    }
    const dmg = effect.damage * scale * attacker.modifiers.damageMult;
    defender.comboDamage += dmg;
    defender.health = Math.max(0, defender.health - dmg);

    const capReached = countsForCombo && (defender.comboCount >= COMBO_HIT_CAP || defender.comboDamage >= defender.def.maxHealth * COMBO_DAMAGE_CAP_RATIO);
    const forceKnockdown = effect.forceKnockdown || capReached || effect.launches;

    defender.vx = effect.knockback.x * (attacker.facing as number);
    if (effect.knockback.y) defender.vy = effect.knockback.y;

    if (forceKnockdown) {
      defender.state = 'knockdown';
      defender.stateTimer = KNOCKDOWN_FRAMES;
      defender.comboCount = 0;
      defender.comboDamage = 0;
      defender.comboResetTimer = 0;
    } else {
      defender.state = 'hitstun';
      defender.stateTimer = effect.stunFrames;
    }

    attacker.hype = Math.min(MAX_HYPE, attacker.hype + dmg * HYPE_GAIN_ON_DEAL_RATIO);
    defender.hype = Math.min(MAX_HYPE, defender.hype + dmg * HYPE_GAIN_ON_TAKE_RATIO);
    this.freezeFrames = Math.max(this.freezeFrames, effect.hitstopFrames);

    events.push({
      type: 'hit',
      attacker: attackerSlot,
      defender: defenderSlot,
      damage: dmg,
      comboHits,
      guardBreak: false,
      hitstop: effect.hitstopFrames,
      knockdown: !!forceKnockdown,
    });

    const threshold = defender.def.bossPhaseThreshold;
    if (threshold && !defender.isCrunchMode && defender.health > 0 && defender.health <= defender.def.maxHealth * threshold) {
      defender.isCrunchMode = true;
      events.push({ type: 'crunchModeEntered', who: defenderSlot });
    }
  }

  // ---------------------------------------------------------------------
  // Buffs, pickups, clock, KO
  // ---------------------------------------------------------------------

  private tickBuffsAndRegen(f: FighterRuntime): void {
    if (f.modifiers.gpuFrames > 0) {
      f.modifiers.gpuFrames--;
      if (f.modifiers.gpuFrames === 0) f.modifiers.damageMult = 1;
    }
    if (f.modifiers.coffeeFrames > 0) {
      f.modifiers.coffeeFrames--;
      if (f.modifiers.coffeeFrames === 0) f.modifiers.speedMult = 1;
    }
    if (f.guardRegenDelay > 0) {
      f.guardRegenDelay--;
    } else if (f.guard < MAX_GUARD) {
      f.guard = Math.min(MAX_GUARD, f.guard + GUARD_REGEN_PER_FRAME);
    }
  }

  private updatePickups(events: SimEvent[]): void {
    if (!this.pickup) {
      if (this.frameCount >= this.nextPickupFrame) {
        const kind = rollPickupKind(this.rng);
        const x = rollPickupX(this.rng);
        this.pickup = { kind, x, age: 0, armed: false };
        events.push({ type: 'pickupSpawned', kind, x, y: GROUND_Y });
      }
      return;
    }
    this.pickup.age++;
    if (this.pickup.age > PICKUP_LIFETIME_FRAMES) {
      this.pickup = null;
      this.nextPickupFrame = rollNextSpawnFrame(this.rng, this.frameCount, false);
      return;
    }
    const p1Dist = Math.abs(this.p1.x - this.pickup.x);
    const p2Dist = Math.abs(this.p2.x - this.pickup.x);
    const p1Near = isGrounded(this.p1) && p1Dist < 16;
    const p2Near = isGrounded(this.p2) && p2Dist < 16;
    if (p1Near || p2Near) {
      let winner: PlayerSlot;
      if (p1Near && p2Near) {
        if (p1Dist < p2Dist) winner = 'p1';
        else if (p2Dist < p1Dist) winner = 'p2';
        else winner = this.pickupsCollectedEver % 2 === 0 ? 'p1' : 'p2';
      } else {
        winner = p1Near ? 'p1' : 'p2';
      }
      const f = this.fighter(winner);
      f.health = applyPickupEffect(this.pickup.kind, f.modifiers, f.health, f.def.maxHealth);
      this.pickupsCollectedEver++;
      events.push({ type: 'pickupCollected', kind: this.pickup.kind, who: winner });
      this.pickup = null;
      this.nextPickupFrame = rollNextSpawnFrame(this.rng, this.frameCount, false);
    }
  }

  private tickClock(events: SimEvent[]): void {
    this.clockFrames--;
    if (this.clockFrames <= 0) {
      this.clockFrames = 0;
      const p1pct = this.p1.health / this.p1.def.maxHealth;
      const p2pct = this.p2.health / this.p2.def.maxHealth;
      this.ended = true;
      if (Math.abs(p1pct - p2pct) < 0.001) {
        this.result = { winner: 'draw', reason: 'draw' };
        events.push({ type: 'roundDraw' });
      } else {
        this.result = { winner: p1pct > p2pct ? 'p1' : 'p2', reason: 'timeout' };
        events.push({ type: 'roundTimeout' });
      }
      this.clearActiveThreats();
    }
  }

  private checkKO(events: SimEvent[]): void {
    const p1Dead = this.p1.health <= 0;
    const p2Dead = this.p2.health <= 0;
    if (!p1Dead && !p2Dead) return;
    this.ended = true;
    if (p1Dead && p2Dead) {
      this.result = { winner: 'draw', reason: 'draw' };
      this.p1.state = 'ko';
      this.p2.state = 'ko';
      events.push({ type: 'ko', loser: 'both' });
    } else if (p1Dead) {
      this.result = { winner: 'p2', reason: 'ko' };
      this.p1.state = 'ko';
      this.p2.state = 'victory';
      events.push({ type: 'ko', loser: 'p1' });
    } else {
      this.result = { winner: 'p1', reason: 'ko' };
      this.p2.state = 'ko';
      this.p1.state = 'victory';
      events.push({ type: 'ko', loser: 'p2' });
    }
    this.clearActiveThreats();
  }

  private clearActiveThreats(): void {
    this.p1.activeMove = null;
    this.p2.activeMove = null;
    this.p1.pendingTargetedStrike = null;
    this.p2.pendingTargetedStrike = null;
    this.projectiles = [];
  }
}

const BASE_ARENA_RIGHT_START = 330;
