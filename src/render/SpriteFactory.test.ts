import { afterEach, describe, expect, it, vi } from 'vitest';

// SpriteFactory imports 'phaser' but only uses it for types at runtime in the paths tested here.
vi.mock('phaser', () => ({ default: {} }));

import {
  artSheetUsable,
  buildFighterVisuals,
  hasUsableArt,
  parseFrameKey,
  resetVisualCache,
  SPRITE_CELL_W,
  SPRITE_CELL_H,
} from './SpriteFactory';
import { CHARACTERS } from '../data/characters';
import { ALL_FIGHTER_IDS } from '../sim/types';

/** Minimal stand-in for the handful of Phaser texture/animation APIs SpriteFactory touches. */
function fakeScene(opts: { sheets: Record<string, { w: number; h: number; cells: number }> }) {
  const textures = new Map(Object.entries(opts.sheets));
  const anims = new Set<string>();
  const canvasTextures = new Map<string, { w: number; h: number }>();
  return {
    createdAnims: anims,
    canvasTextures,
    textures: {
      exists: (k: string) => textures.has(k) || canvasTextures.has(k),
      get: (k: string) => {
        const t = textures.get(k);
        return {
          source: t ? [{ width: t.w, height: t.h }] : [],
          has: (frame: string) => !!t && Number(frame) < t.cells,
        };
      },
      addCanvas: (k: string, c: { width: number; height: number }) => {
        canvasTextures.set(k, { w: c.width, h: c.height });
        return { add: () => {} };
      },
    },
    anims: {
      exists: (k: string) => anims.has(k),
      create: ({ key }: { key: string }) => {
        anims.add(key);
      },
    },
  } as never;
}

/** All four painted sheets for every fighter, at their real shipped geometry. */
function allSheetsPresent(): Record<string, { w: number; h: number; cells: number }> {
  const out: Record<string, { w: number; h: number; cells: number }> = {};
  for (const id of ALL_FIGHTER_IDS) {
    for (const action of ['idle', 'walk', 'attack', 'poses']) {
      out[`${id}_${action}_sheet`] = { w: SPRITE_CELL_W * 2, h: SPRITE_CELL_H * 2, cells: 4 };
    }
  }
  return out;
}

/** Canvas stub so the procedural-rig fallback path can run outside a browser. */
function installCanvasStub(): void {
  const ctx = new Proxy(
    {},
    {
      get: () => () => undefined,
      set: () => true,
    },
  );
  (globalThis as unknown as { document: unknown }).document = {
    createElement: () => ({ width: 0, height: 0, getContext: () => ctx }),
  };
}

afterEach(() => {
  resetVisualCache();
  delete (globalThis as unknown as { document?: unknown }).document;
});

describe('painted-art validation', () => {
  it('accepts a sheet at the real shipped geometry', () => {
    const scene = fakeScene({ sheets: allSheetsPresent() });
    expect(artSheetUsable(scene, 'hunter_idle_sheet')).toBe(true);
    for (const id of ALL_FIGHTER_IDS) expect(hasUsableArt(scene, id)).toBe(true);
  });

  it('rejects a missing sheet, an undersized image, and a sheet short of four cells', () => {
    const sheets = allSheetsPresent();
    delete sheets['hunter_idle_sheet'];
    sheets['kevin_idle_sheet'] = { w: 32, h: 32, cells: 4 }; // placeholder/failed decode
    sheets['al_poses_sheet'] = { w: SPRITE_CELL_W * 2, h: SPRITE_CELL_H * 2, cells: 2 }; // truncated
    const scene = fakeScene({ sheets });
    expect(artSheetUsable(scene, 'hunter_idle_sheet')).toBe(false);
    expect(artSheetUsable(scene, 'kevin_idle_sheet')).toBe(false);
    expect(artSheetUsable(scene, 'al_poses_sheet')).toBe(false);
    expect(hasUsableArt(scene, 'hunter')).toBe(false);
    expect(hasUsableArt(scene, 'priya')).toBe(true); // unaffected characters still use art
  });
});

describe('visual source selection', () => {
  it('uses painted art for every shipped fighter and points every frame at a production sheet', () => {
    const scene = fakeScene({ sheets: allSheetsPresent() });
    for (const id of ALL_FIGHTER_IDS) {
      const v = buildFighterVisuals(scene, CHARACTERS[id]);
      expect(v.source).toBe('art');
      expect(v.cellW).toBe(SPRITE_CELL_W);
      expect(v.cellH).toBe(SPRITE_CELL_H);

      const tokens = [
        v.portraitFrame,
        ...v.jumpFrames,
        ...v.crouchFrames,
        ...v.blockFrames,
        ...v.hitstunFrames,
        ...v.knockdownFrames,
        ...v.wakeupFrames,
        ...v.koFrames,
        ...Object.values(v.moveFrames).flat(),
      ];
      for (const token of tokens) {
        const { texture, frame } = parseFrameKey(token);
        // Never a rig canvas masquerading under an expected name, and always a real cell index.
        expect(texture.startsWith('rig_')).toBe(false);
        expect(texture).toMatch(new RegExp(`^${id}_(idle|walk|attack|poses)_sheet$`));
        expect(frame).toBeGreaterThanOrEqual(0);
        expect(frame).toBeLessThan(4);
      }
      resetVisualCache();
    }
  });

  it('falls back to the procedural rig when a sheet is unusable, under separate texture keys', () => {
    installCanvasStub();
    const sheets = allSheetsPresent();
    delete sheets['hunter_poses_sheet'];
    const scene = fakeScene({ sheets });

    const hunter = buildFighterVisuals(scene, CHARACTERS.hunter);
    expect(hunter.source).toBe('rig');
    // The fallback must not occupy or resemble a production art key -- otherwise a cached rig
    // could silently stand in for missing art and still satisfy an asset check.
    expect(parseFrameKey(hunter.portraitFrame).texture.startsWith('rig_hunter_')).toBe(true);
    expect(hunter.idleAnim).toBe('rig_hunter_idle');
    expect(hunter.dashAnim).toBe('rig_hunter_dash');

    resetVisualCache();
    const kevin = buildFighterVisuals(scene, CHARACTERS.kevin);
    expect(kevin.source).toBe('art'); // one broken character never drags the others onto the rig
    expect(kevin.idleAnim).toBe('kevin_idle');
  });

  it('keeps art and rig anchor geometry distinct so one source never borrows the other pivot', () => {
    installCanvasStub();
    const artScene = fakeScene({ sheets: allSheetsPresent() });
    const art = buildFighterVisuals(artScene, CHARACTERS.hunter);
    resetVisualCache();
    const rigScene = fakeScene({ sheets: {} });
    const rig = buildFighterVisuals(rigScene, CHARACTERS.hunter);

    expect(art.source).toBe('art');
    expect(rig.source).toBe('rig');
    expect(rig.cellW).not.toBe(art.cellW);
    expect(rig.cellH).not.toBe(art.cellH);
    expect(rig.originY).not.toBe(art.originY);
    // Both sources are scaled to land at a comparable on-screen height despite different cells.
    expect(art.cellH * art.gameplayScale).toBeCloseTo(86.4, 1);
    expect(rig.cellH * rig.gameplayScale).toBeCloseTo(92, 1);
  });

  it('gives every move kind at least one frame in both sources', () => {
    installCanvasStub();
    for (const sheets of [allSheetsPresent(), {}]) {
      const scene = fakeScene({ sheets });
      const v = buildFighterVisuals(scene, CHARACTERS.priya);
      for (const [kind, frames] of Object.entries(v.moveFrames)) {
        expect(frames.length, `${v.source}/${kind}`).toBeGreaterThan(0);
      }
      resetVisualCache();
    }
  });
});
