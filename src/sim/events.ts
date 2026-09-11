export type PlayerSlot = 'p1' | 'p2';

export type SimEvent =
  | { type: 'moveStarted'; who: PlayerSlot; moveId: string; kind: string; isSuper: boolean }
  | { type: 'hit'; attacker: PlayerSlot; defender: PlayerSlot; damage: number; comboHits: number; guardBreak: boolean; hitstop: number; knockdown: boolean }
  | { type: 'blocked'; attacker: PlayerSlot; defender: PlayerSlot; damage: number; hitstop: number; guardBreak: boolean }
  | { type: 'grabConnect'; attacker: PlayerSlot; defender: PlayerSlot; damage: number }
  | { type: 'grabEscape'; escaper: PlayerSlot }
  | { type: 'throwBreak' }
  | { type: 'counterTriggered'; who: PlayerSlot }
  | { type: 'ko'; loser: PlayerSlot | 'both' }
  | { type: 'roundTimeout' }
  | { type: 'roundDraw' }
  | { type: 'pickupSpawned'; kind: string; x: number; y: number }
  | { type: 'pickupTelegraph'; x: number }
  | { type: 'pickupCollected'; kind: string; who: PlayerSlot }
  | { type: 'jump'; who: PlayerSlot }
  | { type: 'dash'; who: PlayerSlot }
  | { type: 'landed'; who: PlayerSlot }
  | { type: 'crunchModeEntered'; who: PlayerSlot }
  | { type: 'targetedStrikeMarked'; who: PlayerSlot; x: number; delayFrames: number }
  | { type: 'targetedStrikeLanded'; who: PlayerSlot; x: number }
  | { type: 'projectileReleased'; who: PlayerSlot; moveId: string };
