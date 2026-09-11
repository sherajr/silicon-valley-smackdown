import { InputManager } from './input/InputManager';
import { audioManager } from './audio/AudioManager';
import { loadSaveData, saveSaveData, type SaveData } from './progression/SaveData';
import type { Difficulty, FighterId, StageId } from './sim/types';
import type { LadderStop } from './progression/ArcadeLadder';

export type DummyBehavior = 'idle' | 'block' | 'fightBack';

export interface TrainingOptions {
  dummyBehavior: DummyBehavior;
  showHitboxes: boolean;
}

export interface SessionState {
  mode: 'arcade' | 'versus' | 'training' | null;
  p1Fighter: FighterId;
  p2Fighter: FighterId;
  stage: StageId;
  powerupsEnabled: boolean;
  difficulty: Difficulty;
  arcadeLadder: LadderStop[];
  arcadeIndex: number;
  arcadeFighter: FighterId;
  versusWinsP1: number;
  versusWinsP2: number;
  training: TrainingOptions;
  seed: number;
}

function defaultSession(): SessionState {
  return {
    mode: null,
    p1Fighter: 'hunter',
    p2Fighter: 'kevin',
    stage: 'castro_street',
    powerupsEnabled: true,
    difficulty: 'normal',
    arcadeLadder: [],
    arcadeIndex: 0,
    arcadeFighter: 'hunter',
    versusWinsP1: 0,
    versusWinsP2: 0,
    training: { dummyBehavior: 'idle', showHitboxes: false },
    seed: Date.now() & 0xffffffff,
  };
}

class GameContextImpl {
  save: SaveData = loadSaveData();
  input: InputManager = new InputManager(this.save.bindings.p1, this.save.bindings.p2);
  audio = audioManager;
  session: SessionState = defaultSession();

  constructor() {
    this.audio.setVolumes(this.save.volumes);
  }

  persist(): void {
    saveSaveData(this.save);
  }

  applyBindings(): void {
    this.input.setBindings(this.save.bindings.p1, this.save.bindings.p2);
  }

  resetSession(): void {
    this.session = defaultSession();
  }
}

export const GameContext = new GameContextImpl();
