import { drawArcadeBackdrop } from '../render/arcadeTheme';
import Phaser from 'phaser';
import { SceneKeys } from './sceneKeys';
import { GameContext } from '../GameContext';
import { TransitionGuard } from '../ui/TransitionGuard';
import { MenuNavRepeater } from '../ui/menuInput';
import { BASE_WIDTH, BASE_HEIGHT } from '../sim/constants';
import {
  BINDABLE_ACTIONS,
  DEFAULT_P1_BINDINGS,
  DEFAULT_P2_BINDINGS,
  LAPTOP_P2_BINDINGS,
  clonePlayerBindings,
  findConflicts,
  labelForBinding,
  labelForCode,
  type BindableAction,
  type PlayerSlot,
} from '../input/bindings';

type Tab = 'audio' | 'display' | 'controlsP1' | 'controlsP2' | 'keyTest';
const TABS: Tab[] = ['audio', 'display', 'controlsP1', 'controlsP2', 'keyTest'];
const TAB_LABELS: Record<Tab, string> = {
  audio: 'AUDIO',
  display: 'DISPLAY',
  controlsP1: 'CONTROLS P1',
  controlsP2: 'CONTROLS P2',
  keyTest: 'KEY TEST',
};

export class SettingsScene extends Phaser.Scene {
  private guard = new TransitionGuard();
  private nav = new MenuNavRepeater();
  private tabIndex = 0;
  private rowIndex = 0;
  private tabTexts: Phaser.GameObjects.Text[] = [];
  private bodyText!: Phaser.GameObjects.Text;
  private hintText!: Phaser.GameObjects.Text;
  private capturing: { player: PlayerSlot; action: BindableAction } | null = null;
  private keyTestText!: Phaser.GameObjects.Text;

  constructor() {
    super(SceneKeys.Settings);
  }

  create(): void {
    this.guard.arm(GameContext.input);
    this.tabIndex = 0;
    this.rowIndex = 0;
    this.capturing = null;
    drawArcadeBackdrop(this);

    this.add.text(BASE_WIDTH / 2, 10, 'SETTINGS', { fontFamily: 'monospace', fontSize: '11px', color: '#fff23d' }).setOrigin(0.5, 0);

    this.tabTexts = TABS.map((tab, i) =>
      this.add
        .text(30 + i * 90, 32, TAB_LABELS[tab], { fontFamily: 'monospace', fontSize: '8px', color: '#b9b3da' })
        .setOrigin(0, 0.5),
    );

    this.bodyText = this.add.text(30, 55, '', { fontFamily: 'monospace', fontSize: '9px', color: '#f5f1ff', lineSpacing: 6 });
    this.keyTestText = this.add.text(30, 55, '', { fontFamily: 'monospace', fontSize: '8px', color: '#9fe8d8', wordWrap: { width: BASE_WIDTH - 60 } });
    this.hintText = this.add
      .text(BASE_WIDTH / 2, BASE_HEIGHT - 12, '', { fontFamily: 'monospace', fontSize: '7px', color: '#b9b3da' })
      .setOrigin(0.5, 0.5);

    this.refresh();
  }

  private rowsFor(tab: Tab): string[] {
    if (tab === 'audio') {
      const rows = ['master', 'music', 'sfx', 'chooseFile'];
      if (GameContext.audio.hasCustomTrack()) rows.push('clearTrack');
      return rows;
    }
    if (tab === 'display') return ['screenShake', 'reducedEffects', 'render3D', 'graphicsQuality'];
    if (tab === 'controlsP1') return [...BINDABLE_ACTIONS, 'restore'];
    if (tab === 'controlsP2') return [...BINDABLE_ACTIONS, 'laptopPreset', 'restore'];
    return [];
  }

  private refresh(): void {
    const tab = TABS[this.tabIndex];
    this.tabTexts.forEach((t, i) => t.setColor(i === this.tabIndex ? '#fff23d' : '#6a6a78'));
    this.bodyText.setVisible(tab !== 'keyTest');
    this.keyTestText.setVisible(tab === 'keyTest');

    if (tab === 'audio') {
      const v = GameContext.audio.getVolumes();
      const volRows = [
        ['master', v.master],
        ['music', v.music],
        ['sfx', v.sfx],
      ] as const;
      const rows = this.rowsFor(tab);
      const lines = volRows.map(
        ([label, val], i) => `${i === this.rowIndex ? '> ' : '  '}${label.toUpperCase().padEnd(8)} ${'#'.repeat(Math.round(val * 20)).padEnd(20, '.')} ${Math.round(val * 100)}%`,
      );
      lines.push('');
      lines.push(`Music Track: ${GameContext.audio.getSelectedTrackLabel()}`);
      const chooseIdx = rows.indexOf('chooseFile');
      lines.push(`${chooseIdx === this.rowIndex ? '> ' : '  '}Choose Music File...`);
      const clearIdx = rows.indexOf('clearTrack');
      if (clearIdx >= 0) lines.push(`${clearIdx === this.rowIndex ? '> ' : '  '}Use Original Score`);
      this.bodyText.setText(lines.join('\n'));
      this.hintText.setText('Left/Right to change tab, Up/Down to select, Basic to adjust/choose, Block to go back');
    } else if (tab === 'display') {
      const rows = [
        ['Screen Shake', GameContext.save.screenShake ? 'ON' : 'OFF'],
        ['Reduced Effects', GameContext.save.reducedEffects ? 'ON' : 'OFF'],
        // 3D is the default presentation; this is the explicitly selectable compatibility mode
        // that falls back to the original 2D renderer (see FightScene.create()'s use3D check).
        ['3D Presentation', GameContext.save.render3D ? 'ON' : 'OFF'],
        ['Graphics Quality', GameContext.save.graphicsQuality.toUpperCase()],
      ] as const;
      this.bodyText.setText(rows.map(([label, val], i) => `${i === this.rowIndex ? '> ' : '  '}${label.padEnd(18)} ${val}`).join('\n'));
      this.hintText.setText('Left/Right to change tab, Up/Down to select, Basic to toggle, Block to go back');
    } else if (tab === 'controlsP1' || tab === 'controlsP2') {
      const slot: PlayerSlot = tab === 'controlsP1' ? 'p1' : 'p2';
      const bindings = GameContext.save.bindings[slot];
      const rows = this.rowsFor(tab);
      const lines = rows.map((r, i) => {
        const focused = i === this.rowIndex;
        const prefix = focused ? '> ' : '  ';
        if (r === 'restore') return `${prefix}Restore Defaults`;
        if (r === 'laptopPreset') return `${prefix}Apply Laptop Preset (arrows + J/K/L/;)`;
        const action = r as BindableAction;
        const isCapturingThis = this.capturing?.player === slot && this.capturing?.action === action;
        return `${prefix}${action.padEnd(10)} ${isCapturingThis ? 'Press a key...' : labelForBinding(bindings[action])}`;
      });
      this.bodyText.setText(lines.join('\n'));
      this.hintText.setText(
        this.capturing ? 'Waiting for a new key (Escape to cancel)' : 'Left/Right to change tab, Up/Down to select, Basic to remap, Block to go back',
      );
    } else {
      this.keyTestText.setText('Press any keys to see them detected here:\n\n' + GameContext.input.getHeldCodes().map(labelForCode).join('   '));
      this.hintText.setText('Left/Right to change tab, Block to go back');
    }
  }

  update(): void {
    this.guard.poll(GameContext.input);
    if (!this.guard.ready()) return;

    const frame = GameContext.input.captureFrame();

    if (TABS[this.tabIndex] === 'keyTest') {
      this.refresh();
      if (frame.pausePressed) this.goBackTab();
      const nav = this.nav.update(frame.p1, frame.p2);
      if (nav.left) this.changeTab(-1);
      if (nav.right) this.changeTab(1);
      return;
    }

    if (this.capturing) {
      // Remap capture is handled via InputManager.beginRemapCapture callback; just allow Escape to cancel via pause key.
      if (frame.pausePressed) {
        GameContext.input.cancelRemapCapture();
        this.capturing = null;
        this.refresh();
      }
      return;
    }

    const nav = this.nav.update(frame.p1, frame.p2);
    const tab = TABS[this.tabIndex];

    if (nav.left) this.changeTab(-1);
    if (nav.right) this.changeTab(1);

    if (nav.up) {
      this.rowIndex = Phaser.Math.Wrap(this.rowIndex - 1, 0, Math.max(1, this.rowsFor(tab).length));
      this.refresh();
    }
    if (nav.down) {
      this.rowIndex = Phaser.Math.Wrap(this.rowIndex + 1, 0, Math.max(1, this.rowsFor(tab).length));
      this.refresh();
    }
    if (nav.confirm) this.activateRow();
    if (nav.cancel) this.goBackTab();
  }

  private changeTab(dir: number): void {
    this.tabIndex = Phaser.Math.Wrap(this.tabIndex + dir, 0, TABS.length);
    this.rowIndex = 0;
    GameContext.audio.playSfx('select');
    this.refresh();
  }

  private activateRow(): void {
    const tab = TABS[this.tabIndex];
    GameContext.audio.playSfx('confirm');
    if (tab === 'audio') {
      const rows = this.rowsFor(tab);
      const row = rows[this.rowIndex];
      if (row === 'master' || row === 'music' || row === 'sfx') {
        const v = GameContext.audio.getVolumes();
        v[row] = v[row] >= 0.999 ? 0 : Phaser.Math.Clamp(v[row] + 0.1, 0, 1);
        GameContext.audio.setVolumes(v);
        GameContext.save.volumes = v;
        GameContext.persist();
      } else if (row === 'chooseFile') {
        GameContext.audio.promptChooseFile();
      } else if (row === 'clearTrack') {
        GameContext.audio.clearCustomTrack();
        this.rowIndex = Math.min(this.rowIndex, this.rowsFor(tab).length - 1);
      }
      this.refresh();
    } else if (tab === 'display') {
      if (this.rowIndex === 0) GameContext.save.screenShake = !GameContext.save.screenShake;
      else if (this.rowIndex === 1) GameContext.save.reducedEffects = !GameContext.save.reducedEffects;
      else if (this.rowIndex === 2) GameContext.save.render3D = !GameContext.save.render3D;
      else {
        const order: (typeof GameContext.save.graphicsQuality)[] = ['low', 'medium', 'high'];
        const next = order[(order.indexOf(GameContext.save.graphicsQuality) + 1) % order.length];
        GameContext.save.graphicsQuality = next;
      }
      GameContext.persist();
      this.refresh();
    } else if (tab === 'controlsP1' || tab === 'controlsP2') {
      const slot: PlayerSlot = tab === 'controlsP1' ? 'p1' : 'p2';
      const rows = this.rowsFor(tab);
      const row = rows[this.rowIndex];
      if (row === 'restore') {
        GameContext.save.bindings[slot] = clonePlayerBindings(slot === 'p1' ? DEFAULT_P1_BINDINGS : DEFAULT_P2_BINDINGS);
        GameContext.applyBindings();
        GameContext.persist();
        this.refresh();
      } else if (row === 'laptopPreset') {
        GameContext.save.bindings.p2 = clonePlayerBindings(LAPTOP_P2_BINDINGS);
        GameContext.applyBindings();
        GameContext.persist();
        this.refresh();
      } else {
        this.beginRemap(slot, row as BindableAction);
      }
    }
  }

  private beginRemap(slot: PlayerSlot, action: BindableAction): void {
    this.capturing = { player: slot, action };
    this.refresh();
    GameContext.input.beginRemapCapture((code) => {
      const other: PlayerSlot = slot === 'p1' ? 'p2' : 'p1';
      const conflicts = findConflicts(code, GameContext.save.bindings.p1, GameContext.save.bindings.p2, { player: slot, action });
      if (conflicts.length > 0) {
        this.hintText.setText(`"${labelForCode(code)}" is already used by ${conflicts[0].player.toUpperCase()} ${conflicts[0].action}. Try another key.`);
        this.capturing = null;
        void other;
        return;
      }
      GameContext.save.bindings[slot][action] = [code];
      GameContext.applyBindings();
      GameContext.persist();
      this.capturing = null;
      this.refresh();
    });
  }

  private goBackTab(): void {
    GameContext.audio.playSfx('cancel');
    this.scene.start(SceneKeys.MainMenu);
  }
}
