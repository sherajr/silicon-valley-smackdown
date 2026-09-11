import Phaser from 'phaser';
import { SceneKeys } from './sceneKeys';
import { GameContext } from '../GameContext';
import { MatchState } from '../sim/MatchState';
import { SIM_DT, BASE_WIDTH, GROUND_Y } from '../sim/constants';
import { neutralFrameInput, type CharacterDef, type PlayerFrameInput } from '../sim/types';
import type { FighterRuntime } from '../sim/FighterRuntime';
import type { SimEvent } from '../sim/events';
import { CHARACTERS, ELON_BOSS } from '../data/characters';
import { STAGES } from '../data/stages';
import { FighterView } from '../render/FighterView';
import { StageView } from '../render/StageView';
import { HUD } from '../render/HUD';
import { EffectsView } from '../render/EffectsView';
import { AIController } from '../ai/AIController';
import { MenuList } from '../ui/MenuList';
import { MenuNavRepeater } from '../ui/menuInput';
import { TransitionGuard } from '../ui/TransitionGuard';
import { localBoxToWorld } from '../sim/collision';
import { hurtboxFor } from '../sim/FighterRuntime';

const ARENA_OFFSET_X = 0;
const MAX_STEPS_PER_FRAME = 6;

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
  private p1View!: FighterView;
  private p2View!: FighterView;
  private stageView!: StageView;
  private hud!: HUD;
  private effects!: EffectsView;
  private ai: AIController | null = null;
  private accumulator = 0;
  private phase: Phase = 'playing';
  private pauseContainer!: Phaser.GameObjects.Container;
  private pauseMenu!: MenuList;
  private moveListVisible = false;
  private moveListContainer!: Phaser.GameObjects.Container;
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
    this.mode = GameContext.session.mode ?? 'versus';

    const { p1Fighter, p2Fighter, stage, powerupsEnabled } = GameContext.session;
    this.p1Def = CHARACTERS[p1Fighter];
    this.p2Def = this.mode === 'arcade' && p2Fighter === 'elon' ? ELON_BOSS : CHARACTERS[p2Fighter];

    this.matchState = new MatchState(this.p1Def, this.p2Def, { stage, powerupsEnabled }, GameContext.session.seed + this.matchSeedSalt());

    this.stageView = new StageView(this, STAGES[stage]);
    this.p1View = new FighterView(this, this.p1Def, 150, GROUND_Y);
    const mirror = p1Fighter === p2Fighter && this.mode !== 'arcade';
    this.p2View = new FighterView(this, this.p2Def, 330, GROUND_Y, mirror ? { tintOverride: 0x99c2ff } : undefined);

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

  private matchSeedSalt(): number {
    if (this.mode === 'arcade') return GameContext.session.arcadeIndex * 1000;
    return 0;
  }

  private cleanup(): void {
    this.unsubFocus?.();
    this.stageView.destroy();
    this.p1View.destroy();
    this.p2View.destroy();
    this.hud.destroy();
    this.effects.destroy();
  }

  update(_time: number, delta: number): void {
    this.guard.poll(GameContext.input);

    if (this.phase === 'paused') {
      this.pollPauseInput();
      return;
    }

    if (this.phase === 'playing' && this.guard.ready()) {
      const frame = GameContext.input.captureFrame();
      if (frame.pausePressed) {
        this.enterPause();
        return;
      }
    }

    if (this.phase === 'playing') {
      this.accumulator += delta;
      const stepMs = SIM_DT * 1000;
      let steps = 0;
      while (this.accumulator >= stepMs && steps < MAX_STEPS_PER_FRAME) {
        this.fixedStep();
        this.accumulator -= stepMs;
        steps++;
      }
      if (steps === MAX_STEPS_PER_FRAME) this.accumulator = 0;
    }

    this.renderFrame();
  }

  private fixedStep(): void {
    this.frameCounter++;
    const raw = GameContext.input.captureFrame();
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
          if (e.defender === 'p1') this.p1FlashThisFrame = true;
          else this.p2FlashThisFrame = true;
          if (e.comboHits >= 4) this.hud.showCallout('DISRUPTED!');
          break;
        }
        case 'blocked': {
          const defender = e.defender === 'p1' ? this.matchState.sim.p1 : this.matchState.sim.p2;
          const pos = this.effects.hurtboxCenter(defender);
          this.effects.spawnSpark(pos.x, pos.y, 0x8fbfe0, false);
          GameContext.audio.playSfx(e.guardBreak ? 'guardBreak' : 'blocked');
          if (e.guardBreak) this.hud.showCallout('GUARD BREAK!');
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
          this.stageView.setCrunchLighting(true);
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

  private p1FlashThisFrame = false;
  private p2FlashThisFrame = false;

  private renderFrame(): void {
    const sim = this.matchState.sim;
    this.p1View.update(sim.p1, ARENA_OFFSET_X, this.p1FlashThisFrame);
    this.p2View.update(sim.p2, ARENA_OFFSET_X, this.p2FlashThisFrame);
    this.p1FlashThisFrame = false;
    this.p2FlashThisFrame = false;
    this.effects.updateProjectiles(sim.projectiles);
    this.effects.updatePickup(sim.pickup);
    this.effects.tick();
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
        const active = move.frame >= hit.startupFrame && move.frame < hit.startupFrame + hit.activeFrames;
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
    this.stageView.setCrunchLighting(false);

    this.time.delayedCall(1900, () => {
      if (this.matchState.isMatchOver()) {
        this.finishMatch();
      } else {
        this.matchState.startNextRound();
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
    const bg = this.add.rectangle(0, 0, 220, 160, 0x0a0a12, 0.92).setStrokeStyle(1, 0x33334a);
    this.pauseContainer.add(bg);
    const title = this.add.text(0, -65, 'PAUSED', { fontFamily: 'monospace', fontSize: '12px', color: '#ffd23f' }).setOrigin(0.5, 0.5);
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

  private buildMoveList(): void {
    this.moveListContainer = this.add.container(BASE_WIDTH / 2, 135);
    this.moveListContainer.setDepth(1100);
    const bg = this.add.rectangle(0, 0, 260, 200, 0x0a0a12, 0.95).setStrokeStyle(1, 0x33334a);
    this.moveListContainer.add(bg);
    const moves = this.p1Def.moves;
    const b = GameContext.save.bindings.p1;
    const lines = [
      `${moves.basic1.command} / ${moves.basic2.name} / ${moves.basic3.name}`,
      `Fwd+Basic: ${moves.forwardBasic.name}`,
      `Special: ${moves.special.name}`,
      `Down+Special: ${moves.downSpecial.name}`,
      `Grab: ${moves.grab.name}`,
      `Super: ${moves.super.name}`,
      '',
      `Basic ${b.basic.join('/')}  Special ${b.special.join('/')}`,
      `Block ${b.block.join('/')}  Grab ${b.grab.join('/')}`,
    ];
    const text = this.add.text(0, -85, lines.join('\n'), { fontFamily: 'monospace', fontSize: '8px', color: '#d8d8ee', lineSpacing: 4, align: 'left' }).setOrigin(0.5, 0);
    this.moveListContainer.add(text);
    this.moveListContainer.setVisible(false);
  }

  private toggleMoveList(): void {
    this.moveListVisible = !this.moveListVisible;
    this.moveListContainer.setVisible(this.moveListVisible);
    this.pauseContainer.setVisible(!this.moveListVisible);
  }

  private enterPause(): void {
    if (this.phase !== 'playing') return;
    this.phase = 'paused';
    this.moveListVisible = false;
    this.moveListContainer.setVisible(false);
    this.pauseContainer.setVisible(true);
    GameContext.audio.playSfx('pause');
  }

  private exitPause(): void {
    this.phase = 'playing';
    this.pauseContainer.setVisible(false);
    this.accumulator = 0;
  }

  private pauseNav = new MenuNavRepeater();
  private pollPauseInput(): void {
    if (!this.guard.ready()) return;
    const frame = GameContext.input.captureFrame();
    if (this.moveListVisible) {
      if (frame.p1.blockPressed || frame.p2.blockPressed || frame.pausePressed) this.toggleMoveList();
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
    this.pauseContainer.setVisible(false);
    this.phase = 'playing';
    this.roundBannerShown = false;
    this.hud.showRoundBanner(`ROUND ${this.matchState.roundNumber}`, 700);
  }

  private toMainMenu(): void {
    GameContext.audio.stopMusic();
    this.scene.start(SceneKeys.MainMenu);
  }
}
