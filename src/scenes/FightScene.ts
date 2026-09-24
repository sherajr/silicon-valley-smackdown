import { isHitWindowActive } from '../sim/moveTiming';
import Phaser from 'phaser';
import { SceneKeys } from './sceneKeys';
import { GameContext } from '../GameContext';
import { MatchState } from '../sim/MatchState';
import { SIM_DT, BASE_WIDTH, BASE_HEIGHT, GROUND_Y } from '../sim/constants';
import { neutralFrameInput, type CharacterDef, type MoveDef, type PlayerFrameInput } from '../sim/types';
import type { FighterRuntime } from '../sim/FighterRuntime';
import type { SimEvent } from '../sim/events';
import { CHARACTERS, ELON_BOSS } from '../data/characters';
import { STAGES } from '../data/stages';
import { FighterView, neutralImpact, type FighterImpact } from '../render/FighterView';
import { StageView } from '../render/StageView';
import { HUD } from '../render/HUD';
import { EffectsView } from '../render/EffectsView';
import { Fight3DPresentation } from '../render3d/Fight3DPresentation';
import { has3DModel } from '../render3d/ModelRegistry';
import { has3DStage } from '../render3d/Stage3D';
import { graphicsSettingsFor } from '../render3d/GraphicsSettings';
import { AIController } from '../ai/AIController';
import { MenuList } from '../ui/MenuList';
import { labelForBinding } from '../input/bindings';
import { MenuNavRepeater } from '../ui/menuInput';
import { TransitionGuard } from '../ui/TransitionGuard';
import { localBoxToWorld } from '../sim/collision';
import { hurtboxFor } from '../sim/FighterRuntime';

const ARENA_OFFSET_X = 0;
const MAX_STEPS_PER_FRAME = 6;
/** Rows that fit the move-list panel at the game's 480x270 logical resolution without shrinking text below 7px. */
const MOVE_LIST_ROWS_PER_PAGE = 11;
/**
 * Move-list column widths, in monospace characters. Sized to the widest real content so nothing
 * is truncated: the longest move name is "Disruptive Innovation III" (25), the longest command is
 * "Super (Basic+Special)" (21), and the widest ACTIVE field is a four-window super. Truncating
 * names was actively misleading -- "Disruptive Innovation III" used to render as "...II",
 * producing two rows that read identically.
 */
const COL = { name: 26, command: 23, startup: 4, active: 26, recovery: 5, total: 6 } as const;

type Phase = 'playing' | 'paused' | 'roundEndPause' | 'matchEndPause';

export interface FightSceneResult {
  mode: 'arcade' | 'versus' | 'training';
  matchWinner: 'p1' | 'p2';
  scoreP1: number;
  scoreP2: number;
}

export class FightScene extends Phaser.Scene {
  private guard = new TransitionGuard();
  private matchState!: MatchState;
  private p1Def!: CharacterDef;
  private p2Def!: CharacterDef;
  private p1View: FighterView | null = null;
  private p2View: FighterView | null = null;
  private stageView: StageView | null = null;
  private presentation3d: Fight3DPresentation | null = null;
  private hud!: HUD;
  private effects!: EffectsView;
  private ai: AIController | null = null;
  private accumulator = 0;
  private phase: Phase = 'playing';
  private pauseContainer!: Phaser.GameObjects.Container;
  private pauseMenu!: MenuList;
  private moveListVisible = false;
  private moveListContainer!: Phaser.GameObjects.Container;
  private moveListTitle!: Phaser.GameObjects.Text;
  private moveListHeader!: Phaser.GameObjects.Text;
  private moveListBody!: Phaser.GameObjects.Text;
  private moveListFooter!: Phaser.GameObjects.Text;
  private moveListPage = 0;
  private unsubFocus?: () => void;
  private crunchNotified = false;
  private roundBannerShown = false;
  private hitboxGfx!: Phaser.GameObjects.Graphics;
  private mode: 'arcade' | 'versus' | 'training' = 'versus';
  private frameCounter = 0;

  constructor() {
    super(SceneKeys.Fight);
  }

  create(): void {
    this.guard.arm(GameContext.input);
    this.phase = 'playing';
    this.roundBannerShown = false;
    this.crunchNotified = false;
    this.accumulator = 0;
    this.frameCounter = 0;
    this.mode = GameContext.session.mode ?? 'versus';

    const { p1Fighter, p2Fighter, stage, powerupsEnabled } = GameContext.session;
    this.p1Def = CHARACTERS[p1Fighter];
    this.p2Def = this.mode === 'arcade' && p2Fighter === 'elon' ? ELON_BOSS : CHARACTERS[p2Fighter];

    this.matchState = new MatchState(this.p1Def, this.p2Def, { stage, powerupsEnabled }, GameContext.session.seed + this.matchSeedSalt());

    const mirror = p1Fighter === p2Fighter && this.mode !== 'arcade';
    const use3D =
      GameContext.save.render3D &&
      has3DModel(this.p1Def.id) &&
      has3DModel(this.p2Def.id) &&
      has3DStage(stage);

    if (use3D) {
      // Real 3D presentation for this match: both fighters and the stage have a registered
      // model, so the legacy 2D StageView/FighterView are not constructed at all for this match
      // (see cleanup()/resetViewReactions()/renderFrame() for the corresponding null-guards).
      this.presentation3d = new Fight3DPresentation(
        this.game.canvas,
        graphicsSettingsFor(GameContext.save.graphicsQuality),
        STAGES[stage],
        this.p1Def,
        this.p2Def,
        mirror ? 0x99c2ff : undefined,
      );
    } else {
      // Falls back to the 2D renderer honestly: either 3D is disabled in Settings, or this
      // fighter/stage combination has no registered 3D asset yet (see ModelRegistry/Stage3D).
      this.stageView = new StageView(this, STAGES[stage]);
      // Scale comes from the resolved visual source (painted cells and the procedural rig have
      // different cell sizes), so both render the fighter at the same on-screen height.
      this.p1View = new FighterView(this, this.p1Def, 150, GROUND_Y);
      this.p2View = new FighterView(this, this.p2Def, 330, GROUND_Y, mirror ? { tintOverride: 0x99c2ff } : undefined);
    }

    const p1Label = 'P1';
    const p2Label = this.mode === 'versus' ? 'P2' : this.mode === 'training' ? 'CPU' : 'CPU';
    this.hud = new HUD(this, this.p1Def, this.p2Def, p1Label, p2Label);
    this.effects = new EffectsView(this, ARENA_OFFSET_X);
    this.effects.setPreferences(GameContext.save.reducedEffects, GameContext.save.screenShake);

    if (this.mode === 'arcade') {
      this.ai = new AIController(this.p2Def.id, GameContext.session.difficulty, GameContext.session.seed + 777);
    } else {
      this.ai = null;
    }

    this.hitboxGfx = this.add.graphics();
    this.hitboxGfx.setDepth(900);

    this.buildPauseMenu();
    this.buildMoveList();

    this.unsubFocus = GameContext.input.onFocusChange((focused) => {
      if (!focused) this.enterPause();
    });

    GameContext.audio.playMusic(STAGES[stage].musicTrackId);
    GameContext.audio.playSfx('roundStart');
    this.hud.showRoundBanner(`ROUND ${this.matchState.roundNumber}`, 700);
    this.time.delayedCall(750, () => {
      if (!this.roundBannerShown) {
        GameContext.audio.playSfx('confirm');
        this.hud.showRoundBanner('FIGHT!', 500);
      }
    });

    this.events.once('shutdown', () => this.cleanup());
  }

  /** Clears held reaction poses and pending impact edges so nothing carries into a fresh round. */
  private resetViewReactions(): void {
    this.p1View?.resetReactionState();
    this.p2View?.resetReactionState();
    this.presentation3d?.resetReactionState();
    this.p1Impact = neutralImpact();
    this.p2Impact = neutralImpact();
  }

  private matchSeedSalt(): number {
    if (this.mode === 'arcade') return GameContext.session.arcadeIndex * 1000;
    return 0;
  }

  private cleanup(): void {
    this.unsubFocus?.();
    GameContext.audio.setIntensity(1);
    this.stageView?.destroy();
    this.p1View?.destroy();
    this.p2View?.destroy();
    this.presentation3d?.dispose();
    this.hud.destroy();
    this.effects.destroy();
  }

  update(_time: number, delta: number): void {
    this.guard.poll(GameContext.input);

    if (this.phase === 'paused') {
      this.pollPauseInput();
      return;
    }

    // captureFrame() must be called exactly once per fixed sim tick -- it consumes
    // press *edges* as a side effect, so polling it here too would silently eat
    // every Basic/Special/Grab press before fixedStep() ever saw it. Pause is
    // instead read from the same per-tick capture inside fixedStep().
    if (this.phase === 'playing') {
      this.accumulator += delta;
      const stepMs = SIM_DT * 1000;
      let steps = 0;
      while (this.accumulator >= stepMs && steps < MAX_STEPS_PER_FRAME && this.phase === 'playing') {
        this.fixedStep();
        this.accumulator -= stepMs;
        steps++;
      }
      if (steps === MAX_STEPS_PER_FRAME) this.accumulator = 0;
    }

    this.renderFrame(delta);
  }

  private fixedStep(): void {
    this.frameCounter++;
    const raw = GameContext.input.captureFrame();

    if (this.guard.ready() && raw.pausePressed) {
      this.enterPause();
      return;
    }

    const p1Input: PlayerFrameInput = raw.p1;
    let p2Input: PlayerFrameInput;

    if (this.mode === 'versus') {
      p2Input = raw.p2;
    } else if (this.mode === 'arcade' && this.ai) {
      this.ai.observe(this.frameCounter, this.matchState.sim.p1);
      p2Input = this.ai.decide(this.frameCounter, this.matchState.sim.p2);
    } else {
      p2Input = this.dummyInput();
    }

    const events = this.matchState.step(p1Input, p2Input);
    this.handleEvents(events);

    if (this.matchState.sim.ended && this.phase === 'playing') {
      this.onRoundEnded();
    }
  }

  private dummyInput(): PlayerFrameInput {
    const out = neutralFrameInput();
    const behavior = GameContext.session.training.dummyBehavior;
    if (behavior === 'idle') return out;
    const self = this.matchState.sim.p2;
    const opp = this.matchState.sim.p1;
    const dist = Math.abs(self.x - opp.x);
    if (behavior === 'block') {
      if (self.state === 'idle' || self.state === 'walk' || self.state === 'crouch') out.blockHeld = dist < 90;
      return out;
    }
    if (dist > 50) {
      if (opp.x > self.x) out.right = true;
      else out.left = true;
    } else if (self.state === 'idle' || self.state === 'walk') {
      out.basicHeld = true;
      out.basicPressed = true;
    }
    return out;
  }

  private handleEvents(events: SimEvent[]): void {
    for (const e of events) {
      switch (e.type) {
        case 'hit': {
          const defender = e.defender === 'p1' ? this.matchState.sim.p1 : this.matchState.sim.p2;
          const pos = this.effects.hurtboxCenter(defender);
          this.effects.spawnSpark(pos.x, pos.y, 0xffe36e, e.damage > 14);
          GameContext.audio.playSfx(e.damage > 14 ? 'hitHeavy' : 'hitLight');
          if (e.defender === 'p1') this.p1Impact.hit = true;
          else this.p2Impact.hit = true;
          if (e.comboHits >= 4) this.hud.showCallout('DISRUPTED!');
          break;
        }
        case 'blocked': {
          const defender = e.defender === 'p1' ? this.matchState.sim.p1 : this.matchState.sim.p2;
          const pos = this.effects.hurtboxCenter(defender);
          this.effects.spawnSpark(pos.x, pos.y, 0x8fbfe0, false);
          GameContext.audio.playSfx(e.guardBreak ? 'guardBreak' : 'blocked');
          if (e.guardBreak) this.hud.showCallout('GUARD BREAK!');
          // A guard break is a recoil, not a successful guard: it routes to the stagger frames via
          // the 'guardbreak' state, so only a non-breaking block raises the guard-impact signal.
          if (!e.guardBreak) {
            const impact = e.defender === 'p1' ? this.p1Impact : this.p2Impact;
            impact.blocked = true;
            impact.blockedCrouching = e.crouching;
          }
          break;
        }
        case 'grabConnect': {
          GameContext.audio.playSfx('throw');
          break;
        }
        case 'counterTriggered':
          GameContext.audio.playSfx('guardBreak');
          this.hud.showCallout('OBJECTION!');
          break;
        case 'ko':
          GameContext.audio.playSfx('ko');
          if (e.loser !== 'both') {
            const loser = e.loser === 'p1' ? this.matchState.sim.p1 : this.matchState.sim.p2;
            const pos = this.effects.hurtboxCenter(loser);
            this.effects.spawnKoBurst(pos.x, pos.y);
          }
          break;
        case 'pickupSpawned':
          GameContext.audio.playSfx('pickup');
          break;
        case 'pickupCollected':
          GameContext.audio.playSfx('pickup');
          this.hud.showCallout(e.kind === 'gpu' ? 'OVERCLOCKED!' : e.kind === 'coffee' ? 'CAFFEINATED!' : 'SIGNING BONUS!');
          break;
        case 'crunchModeEntered':
          this.crunchNotified = true;
          this.stageView?.setCrunchLighting(true);
          this.presentation3d?.setCrunchLighting(true);
          GameContext.audio.setIntensity(1.08);
          this.hud.showCallout('CRUNCH MODE');
          break;
        case 'moveStarted':
          if (e.isSuper) GameContext.audio.playSfx('super');
          else if (e.kind === 'special' || e.kind === 'downSpecial') GameContext.audio.playSfx('projectile');
          break;
        default:
          break;
      }
    }
  }

  // Accumulated across every fixed step that ran since the last render, then consumed once by
  // renderFrame(). Reading only the newest step would drop a hit or block whenever several sim
  // steps land inside one display frame.
  private p1Impact: FighterImpact = neutralImpact();
  private p2Impact: FighterImpact = neutralImpact();

  private renderFrame(delta: number): void {
    const sim = this.matchState.sim;
    if (this.presentation3d) {
      this.presentation3d.update(sim.p1, sim.p2, this.p1Impact, this.p2Impact, sim.frameCount);
    } else {
      this.p1View!.update(sim.p1, ARENA_OFFSET_X, this.p1Impact, delta, sim.frameCount);
      this.p2View!.update(sim.p2, ARENA_OFFSET_X, this.p2Impact, delta, sim.frameCount);
    }
    this.p1Impact = neutralImpact();
    this.p2Impact = neutralImpact();
    this.effects.updateProjectiles(sim.projectiles);
    this.effects.updatePickup(sim.pickup);
    this.effects.tick(delta);
    this.hud.update(sim.p1, sim.p2, this.matchState.scoreP1, this.matchState.scoreP2, sim.clockFrames);

    if (GameContext.session.training.showHitboxes) this.drawHitboxes();
    else this.hitboxGfx.clear();
  }

  private drawHitboxes(): void {
    this.hitboxGfx.clear();
    const sim = this.matchState.sim;
    for (const f of [sim.p1, sim.p2]) {
      const hb = localBoxToWorld(hurtboxFor(f), f.x, f.y, 1);
      this.hitboxGfx.lineStyle(1, 0x35c26b, 0.9);
      this.hitboxGfx.strokeRect(ARENA_OFFSET_X + hb.left, GROUND_Y + hb.top, hb.right - hb.left, hb.bottom - hb.top);
    }
    for (const f of [sim.p1, sim.p2]) {
      if (f.state !== 'attack' || !f.activeMove) continue;
      const move = f.activeMove;
      for (const hit of move.def.hits) {
        const active = isHitWindowActive(hit, move.frame);
        if (!active) continue;
        const box = localBoxToWorld(hit.box, f.x, f.y, f.facing);
        this.hitboxGfx.lineStyle(1, 0xff5555, 0.95);
        this.hitboxGfx.strokeRect(ARENA_OFFSET_X + box.left, GROUND_Y + box.top, box.right - box.left, box.bottom - box.top);
      }
    }
  }

  // ---------------------------------------------------------------------
  // Round / match end flow
  // ---------------------------------------------------------------------

  private onRoundEnded(): void {
    this.phase = 'roundEndPause';
    const result = this.matchState.sim.result!;
    let text: string;
    if (result.reason === 'draw') text = 'DRAW';
    else if (result.reason === 'timeout') text = `TIME UP - ${result.winner.toUpperCase()} WINS`;
    else text = `K.O. - ${result.winner.toUpperCase()} WINS`;
    this.hud.showRoundBanner(text, 1400);
    this.stageView?.setCrunchLighting(false);
    this.presentation3d?.setCrunchLighting(false);

    this.time.delayedCall(1900, () => {
      if (this.matchState.isMatchOver()) {
        this.finishMatch();
      } else {
        this.matchState.startNextRound();
        this.resetViewReactions();
        this.roundBannerShown = false;
        this.crunchNotified = false;
        this.hud.showRoundBanner(`ROUND ${this.matchState.roundNumber}`, 700);
        this.time.delayedCall(750, () => this.hud.showRoundBanner('FIGHT!', 500));
        GameContext.audio.playSfx('roundStart');
        this.phase = 'playing';
      }
    });
  }

  private finishMatch(): void {
    this.phase = 'matchEndPause';
    this.time.delayedCall(1600, () => {
      const winner = this.matchState.matchWinner!;
      if (this.mode === 'training') {
        this.matchState.resetMatch();
        this.resetViewReactions();
        this.phase = 'playing';
        this.hud.showRoundBanner('TRAINING RESET', 600);
        return;
      }
      const result: FightSceneResult = {
        mode: this.mode,
        matchWinner: winner,
        scoreP1: this.matchState.scoreP1,
        scoreP2: this.matchState.scoreP2,
      };
      this.scene.start(SceneKeys.Results, result);
    });
  }

  // ---------------------------------------------------------------------
  // Pause menu
  // ---------------------------------------------------------------------

  private buildPauseMenu(): void {
    this.pauseContainer = this.add.container(BASE_WIDTH / 2, 135);
    this.pauseContainer.setDepth(1000);
    const bg = this.add.rectangle(0, 0, 220, 160, 0x100a30, 0.92).setStrokeStyle(1, 0x854ac7);
    this.pauseContainer.add(bg);
    const title = this.add.text(0, -65, 'PAUSED', { fontFamily: 'monospace', fontSize: '12px', color: '#fff23d' }).setOrigin(0.5, 0.5);
    this.pauseContainer.add(title);

    this.pauseMenu = new MenuList(this, 0, -30, 20, [
      { label: 'Resume', onSelect: () => this.exitPause() },
      { label: 'Move List', onSelect: () => this.toggleMoveList() },
      { label: 'Restart Match', onSelect: () => this.restartMatch() },
      { label: 'Main Menu', onSelect: () => this.toMainMenu() },
    ]);
    this.pauseContainer.add(this.pauseMenu.container);
    this.pauseContainer.setVisible(false);
  }

  /**
   * Frame-data line for one move, read straight from its authoritative MoveDef. Every number
   * shown is a real field on the definition -- nothing is inferred or averaged.
   *
   * ACTIVE is where this move can connect, expressed as inclusive zero-based move frames
   * ("4-6" = frames 4, 5 and 6), which is why the panel header says so explicitly: it is a
   * frame *range*, not a duration. Moves that do not strike with a melee window report what
   * they actually do instead of a fabricated one -- a projectile's release frame, a counter's
   * armed window, a grab's catch window, or a telegraphed ground strike. Multi-window moves
   * list every window, comma-separated.
   */
  private moveActiveField(m: MoveDef): string {
    const ranges = m.hits.map((h) => `${h.startupFrame}-${h.startupFrame + h.activeFrames - 1}`);
    if (m.isGrab && ranges.length) return `grab ${ranges.join(',')}`;
    if (ranges.length) return ranges.join(','); // every window, never just the first
    if (m.projectile) return `shot@${m.projectile.releaseFrame ?? m.startup}`;
    if (m.isCounter) return m.counterWindow ? `parry ${m.counterWindow.start}-${m.counterWindow.end}` : 'parry';
    if (m.targetedStrike) return 'ground strike';
    return '--';
  }

  private moveDataRow(m: MoveDef): string {
    return (
      m.name.padEnd(COL.name) +
      m.command.padEnd(COL.command) +
      String(m.startup).padStart(COL.startup) +
      this.moveActiveField(m).padStart(COL.active) +
      String(m.recovery).padStart(COL.recovery) +
      String(m.totalFrames).padStart(COL.total)
    );
  }

  /** Column header built from the same widths as the rows, so the two can never drift apart. */
  private moveListHeaderLine(): string {
    return (
      'MOVE'.padEnd(COL.name) +
      'COMMAND'.padEnd(COL.command) +
      'ST'.padStart(COL.startup) +
      'ACTIVE'.padStart(COL.active) +
      'REC'.padStart(COL.recovery) +
      'TOTAL'.padStart(COL.total)
    );
  }

  /** Control reminder for one player, including Block and Grab -- both were dropped from the old list. */
  private bindingSummary(slot: 'p1' | 'p2'): string {
    const b = GameContext.save.bindings[slot];
    return (
      `Move ${labelForBinding(b.moveLeft)}/${labelForBinding(b.moveRight)}  ` +
      `Jump ${labelForBinding(b.up)}  Crouch ${labelForBinding(b.down)}  ` +
      `Basic ${labelForBinding(b.basic)}  Special ${labelForBinding(b.special)}  ` +
      `Block ${labelForBinding(b.block)}  Grab ${labelForBinding(b.grab)}`
    );
  }

  private buildMoveList(): void {
    this.moveListContainer = this.add.container(BASE_WIDTH / 2, BASE_HEIGHT / 2);
    this.moveListContainer.setDepth(1100);
    const bg = this.add.rectangle(0, 0, 466, 256, 0x100a30, 0.96).setStrokeStyle(1, 0x854ac7);
    this.moveListContainer.add(bg);

    this.moveListTitle = this.add
      .text(0, -121, '', { fontFamily: 'monospace', fontSize: '8px', color: '#fff23d' })
      .setOrigin(0.5, 0);
    this.moveListHeader = this.add
      .text(-229, -107, '', { fontFamily: 'monospace', fontSize: '7px', color: '#9f8fd8', lineSpacing: 2 })
      .setOrigin(0, 0);
    this.moveListBody = this.add
      .text(-229, -86, '', { fontFamily: 'monospace', fontSize: '7px', color: '#f5f1ff', lineSpacing: 3 })
      .setOrigin(0, 0);
    this.moveListFooter = this.add
      .text(0, 122, '', { fontFamily: 'monospace', fontSize: '7px', color: '#a8d8ff', align: 'center' })
      .setOrigin(0.5, 1);
    this.moveListContainer.add([this.moveListTitle, this.moveListHeader, this.moveListBody, this.moveListFooter]);
    this.moveListContainer.setVisible(false);
  }

  /** Which fighter's moves the list is showing, and whose controls print alongside them. */
  private moveListSlot: 'p1' | 'p2' = 'p1';

  private movesFor(slot: 'p1' | 'p2'): MoveDef[] {
    return Object.values(slot === 'p1' ? this.p1Def.moves : this.p2Def.moves) as MoveDef[];
  }

  private moveListPageCount(slot: 'p1' | 'p2'): number {
    return Math.max(1, Math.ceil(this.movesFor(slot).length / MOVE_LIST_ROWS_PER_PAGE));
  }

  private refreshMoveList(): void {
    const slot = this.moveListSlot;
    const def = slot === 'p1' ? this.p1Def : this.p2Def;
    const owner = slot === 'p1' ? 'P1' : this.mode === 'versus' ? 'P2' : 'CPU';
    const moves = this.movesFor(slot);
    const pages = this.moveListPageCount(slot);
    this.moveListPage = Math.min(this.moveListPage, pages - 1);
    const start = this.moveListPage * MOVE_LIST_ROWS_PER_PAGE;

    this.moveListTitle.setText(`${owner} - ${def.name.toUpperCase()}   MOVE LIST   page ${this.moveListPage + 1}/${pages}`);
    this.moveListHeader.setText(
      this.moveListHeaderLine() + '\n' +
        '60 frames = 1 second.  ST startup,  ACTIVE inclusive 0-based move frames,  REC recovery.',
    );
    this.moveListBody.setText(moves.slice(start, start + MOVE_LIST_ROWS_PER_PAGE).map((m) => this.moveDataRow(m)).join('\n'));

    // Versus exposes both players' sets; training/arcade names whose set is on screen.
    const swap = this.mode === 'versus' ? `Block: show ${slot === 'p1' ? 'P2' : 'P1'}   ` : '';
    const page = pages > 1 ? 'Grab: next page   ' : '';
    this.moveListFooter.setText(`${this.bindingSummary(slot)}` + '\n' + `${swap}${page}Special or Pause: back to menu`);
  }

  private toggleMoveList(): void {
    this.moveListVisible = !this.moveListVisible;
    if (this.moveListVisible) {
      this.moveListSlot = 'p1';
      this.moveListPage = 0;
      this.refreshMoveList();
    }
    this.moveListContainer.setVisible(this.moveListVisible);
    this.pauseContainer.setVisible(!this.moveListVisible);
  }

  private enterPause(): void {
    if (this.phase !== 'playing') return;
    this.phase = 'paused';
    this.moveListVisible = false;
    this.moveListContainer.setVisible(false);
    this.pauseContainer.setVisible(true);
    // Discard any buffered/held attack requests so pausing (including on focus loss)
    // and later resuming can never launch an attack neither player actually intended now.
    this.matchState.sim.p1.queue.clear();
    this.matchState.sim.p2.queue.clear();
    GameContext.audio.pauseMusic();
    GameContext.audio.playSfx('pause');
  }

  private exitPause(): void {
    this.moveListVisible = false;
    this.moveListContainer.setVisible(false);
    this.phase = 'playing';
    this.pauseContainer.setVisible(false);
    this.accumulator = 0;
    GameContext.audio.resumeMusic();
  }

  private pauseNav = new MenuNavRepeater();
  private pollPauseInput(): void {
    if (!this.guard.ready()) return;
    const frame = GameContext.input.captureFrame();
    if (this.moveListVisible) {
      // Block swaps which player's set is shown (versus only); Grab pages through a long set.
      if (this.mode === 'versus' && (frame.p1.blockPressed || frame.p2.blockPressed)) {
        this.moveListSlot = this.moveListSlot === 'p1' ? 'p2' : 'p1';
        this.moveListPage = 0;
        this.refreshMoveList();
        GameContext.audio.playSfx('select');
        return;
      }
      if (frame.p1.grabPressed || frame.p2.grabPressed) {
        this.moveListPage = (this.moveListPage + 1) % this.moveListPageCount(this.moveListSlot);
        this.refreshMoveList();
        GameContext.audio.playSfx('select');
        return;
      }
      const backOut =
        frame.p1.specialPressed ||
        frame.p2.specialPressed ||
        frame.pausePressed ||
        (this.mode !== 'versus' && (frame.p1.blockPressed || frame.p2.blockPressed));
      if (backOut) this.toggleMoveList();
      return;
    }
    const nav = this.pauseNav.update(frame.p1, frame.p2);
    if (nav.up) this.pauseMenu.moveUp();
    if (nav.down) this.pauseMenu.moveDown();
    if (nav.confirm) this.pauseMenu.confirm();
    if (frame.pausePressed) this.exitPause();
  }

  private restartMatch(): void {
    this.matchState.resetMatch();
    this.resetViewReactions();
    this.moveListVisible = false;
    this.moveListContainer.setVisible(false);
    this.pauseContainer.setVisible(false);
    this.phase = 'playing';
    this.roundBannerShown = false;
    this.hud.showRoundBanner(`ROUND ${this.matchState.roundNumber}`, 700);
    GameContext.audio.resumeMusic();
  }

  private toMainMenu(): void {
    GameContext.audio.stopMusic();
    this.scene.start(SceneKeys.MainMenu);
  }
}
