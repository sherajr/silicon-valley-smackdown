import './styles.css';
import { ArenaSim, noInput } from './Simulation';
import type { Controls, DummyMode, Fighter, GameEvent, MatchOptions, Mode } from './Simulation';
import { ArenaRenderer } from './Renderer';
import { ArenaInput } from './Input';
import { ArenaAudio } from './Audio';
import { FixedStepper } from './stepper';
import { describeBand, describeCombos, describeMoves, THROW_HINT } from './moveInfo';
import { ROSTER, ROLES, STAGE_NAMES, STAGE_TAGS, FIGHTER_ACCENTS, SPECIAL_NAMES } from './data';
import { QUALITY, QUALITY_TIERS, SETTINGS_KEY, hasSavedQuality, migrateSettings, serializeSettings } from './quality';
import type { ArenaSettings, QualityTier } from './quality';
import { OnlineClient } from './net/OnlineClient';
import { RollbackSession } from './net/RollbackSession';
import { inviteUrl, lobbyMarkup, onlineEnabled, onlineGateMarkup, publicGameUrl, relayUrl, roomFromLocation } from './net/lobbyView';
import { ERROR_TEXT } from '../../shared/onlineProtocol';
import type { MatchDescriptor, RoomView, ServerMessage } from '../../shared/onlineProtocol';

const brand = '<div class="brand"><span class="brand-mark">SV</span><span>Silicon Valley<br>Smackdown</span></div>';
const button = (id: string, label: string, primary = false) => `<button id="${id}" class="${primary ? 'primary-btn' : 'ghost-btn'}">${label}${primary ? '<span class="arrow">↗</span>' : ''}</button>`;
const formatTime = (ticks: number) => `${Math.floor(Math.ceil(ticks / 60) / 60)}:${String(Math.ceil(ticks / 60) % 60).padStart(2, '0')}`;
/** Persisted preferences. Older saves (a single "high quality shadows" flag) are migrated to a graphics preset. */
const loadSettings = (): { settings: ArenaSettings; chosen: boolean } => {
  let reduced = false, saved: unknown = {};
  try { reduced = matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { /* matchMedia unavailable */ }
  try { saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}'); } catch { /* Local files/private browsing may deny storage. */ }
  return { settings: migrateSettings(saved, reduced), chosen: hasSavedQuality(saved) };
};

/** Practice options. They live on the app so they survive a training reset. */
/** What the HUD last wrote for one player, so unchanged values never touch the DOM. */
interface HudCache { damage: number; color: string; shield: number; buff: string; stocks: string; marker: string; hidden: boolean; edge: boolean }
export interface TrainingOptions { dummy: DummyMode; boxes: boolean; info: boolean; step: boolean }

const keyGlyphs = (c: Controls) => [c.x < 0 ? '←' : '', c.x > 0 ? '→' : '', c.up ? '↑' : '', c.down ? '↓' : '', c.attack ? 'ATK' : '', c.special ? 'SPC' : '', c.grab ? 'GRB' : '', c.jump ? 'JMP' : '', c.shield ? 'SHD' : ''].filter(Boolean).join(' ') || '·';
/** One-line description of what a fighter is doing, for the training readout. */
export function stateLabel(f: Fighter): string {
  if (f.respawn > 0) return 'RESPAWN';
  if (f.heldBy !== null) return 'HELD';
  if (f.stun > 0) return `HITSTUN ${f.stun}`;
  if (f.roll > 0) return 'ROLL';
  if (f.ledge > 0) return 'LEDGE';
  if (f.hold) return `HOLDING ${f.hold.age}/54${f.attack ? ` ${f.attack.def.name}` : ''}`;
  const a = f.attack;
  if (a) return `${a.def.name} ${a.age < a.start ? 'startup' : a.age < a.start + a.active ? 'ACTIVE' : 'recovery'} f${a.age}/${a.duration}`;
  if (f.busy > 0) return `${f.busyKind.toUpperCase()} ${f.busy}`;
  if (f.guarding) return 'SHIELD';
  return f.grounded ? (Math.abs(f.vx) > 0.03 ? 'WALK' : 'IDLE') : 'AIR';
}

export class ArenaApp {
  sim: ArenaSim;
  view: ArenaRenderer;
  input = new ArenaInput();
  audio = new ArenaAudio();
  screen: 'home' | 'select' | 'lobby' | 'match' | 'result' = 'home';
  paused = false;
  ui: HTMLDivElement;
  private loaded = loadSettings();
  settings: ArenaSettings = this.loaded.settings;
  training: TrainingOptions = { dummy: 'idle', boxes: false, info: false, step: false };
  stepper = new FixedStepper();
  private portraits: string[];
  private picks: [number, number] = [0, 1];
  private stage = 0;
  private mode: Mode = 'cpu';
  private activeSlot = 0;
  private last = 0;
  private visualTime = 0;
  private toastTime = 0;
  private goTime = 0;
  private resultDelay = 0;
  private stepRequests = 0;
  private lastCommands: [Controls, Controls] | null = null;
  private ladder: number[] = [];
  private ladderIndex = 0;
  private hud: { damage: HTMLElement; stocks: HTMLElement; shield: HTMLElement; marker: HTMLElement; buff: HTMLElement; combo: HTMLElement; last: HudCache }[] = [];
  private lastCenter = '';
  private lastTimer = '';
  private toastOpacity = '';
  private comboUntil = [0, 0];
  private timer: HTMLElement | null = null;
  private center: HTMLElement | null = null;
  private toast: HTMLElement | null = null;
  private hint: HTMLElement | null = null;
  private readout: HTMLElement | null = null;
  private modalReturn: (() => void) | null = null;
  private animationFrame = 0;
  private net: OnlineClient | null = null;
  private netView: RoomView | null = null;
  private netMatch: MatchDescriptor | null = null;
  private netSession: RollbackSession | null = null;
  private netStartAt = 0;
  private netStarted = false;
  private netAccumulator = 0;
  private netOverlay = false;
  private netResult: Extract<ServerMessage, { t: 'result' }> | null = null;
  private netInterrupted: string | null = null;
  private netStatus = 'Connecting…';
  private netWelcomed = false;
  private netPending: 'create' | { t: 'join'; code: string } | null = null;
  private netReconnects = 0;
  private netResultSent = false;
  private netFixture: Map<number, Controls> | null = null;
  private readonly testMode = new URLSearchParams(location.search).get('arenaTest') === '1';

  constructor(container: HTMLElement) {
    container.innerHTML = '<div id="arena"><div id="arena-ui"></div></div>';
    const root = document.getElementById('arena')!; this.ui = document.getElementById('arena-ui') as HTMLDivElement;
    this.view = new ArenaRenderer(root, { quality: this.settings.quality, reducedMotion: this.settings.reducedMotion, cameraShake: this.settings.cameraShake, initialQuality: !this.loaded.chosen }); root.append(this.ui);
    this.settings.quality = this.view.options.quality;          // a software rasterizer may have started on Performance; shown, not saved, until the player chooses
    this.portraits = this.view.portraits();
    this.sim = new ArenaSim(this.options()); this.view.setMatch(this.picks, 0);
    this.audio.setMute(this.settings.muted); this.audio.music = this.settings.music;
    this.input.onPause = () => {
      if (this.modalReturn) { const back = this.modalReturn; this.modalReturn = null; back(); }
      else if (this.netMatch && this.screen === 'match') this.toggleOnlineOverlay();
      else if (this.screen === 'match') this.togglePause();
      else if (this.screen === 'select' || this.screen === 'lobby') this.home();
    };
    this.input.onFullscreen = () => this.fullscreen(); this.input.onMute = () => this.toggleMute();
    this.input.onStep = () => { if (this.training.step && this.mode === 'training' && this.screen === 'match' && !this.paused) this.stepRequests++; };
    // The renderer watches its own container and the display scale; fullscreen changes just prompt a re-measure.
    document.addEventListener('fullscreenchange', () => this.view.resize());
    window.addEventListener('blur', () => { if (!this.netMatch && this.screen === 'match' && !this.paused) this.togglePause(true); });
    document.addEventListener('visibilitychange', () => {
      if (this.netMatch) return;
      if (document.hidden && this.screen === 'match' && !this.paused) this.togglePause(true);
      this.last = 0; this.stepper.reset();
    });
    this.view.renderer.domElement.addEventListener('webglcontextlost', e => {
      e.preventDefault(); cancelAnimationFrame(this.animationFrame); this.input.active = false;
      this.ui.innerHTML = '<div class="fatal"><div><h2>The graphics connection was interrupted.</h2><p>Reload the game to reconnect. If it happens again, choose Performance graphics in the match setup.</p><button class="primary-btn" id="reload">Reload game</button></div></div>';
      this.bind('reload', () => location.reload());
    });
    this.home();
    const pendingRoom = onlineEnabled() ? roomFromLocation() : null;
    if (pendingRoom) this.openOnline(pendingRoom, true);
    this.animationFrame = requestAnimationFrame(t => this.frame(t));
    // Debug controls exist only when explicitly requested; production users never expose internals.
    if (this.testMode) (window as unknown as { __arena: ArenaApp }).__arena = this;
  }
  private options(): MatchOptions { return { fighters: [...this.picks], stage: this.stage, mode: this.mode, difficulty: this.settings.difficulty, items: this.settings.items }; }
  private save() { try { localStorage.setItem(SETTINGS_KEY, serializeSettings(this.settings)); } catch { /* Optional persistence. */ } }
  private bind(id: string, fn: () => void) { document.getElementById(id)?.addEventListener('click', fn); }
  private fullscreen() {
    const request = document.fullscreenElement ? document.exitFullscreen?.() : document.documentElement.requestFullscreen?.();
    void request?.catch(() => this.showToast('Use your browser’s fullscreen command.'));
  }
  private toggleMute() {
    this.settings.muted = !this.settings.muted; this.audio.setMute(this.settings.muted); this.save();
    const label = this.settings.muted ? 'SOUND OFF' : 'SOUND ON';
    for (const id of ['mute', 'hud-mute', 'pause-mute']) { const e = document.getElementById(id); if (e) e.textContent = label; }
  }
  home() {
    this.shutdownNet();
    this.screen = 'home'; this.paused = false; this.modalReturn = null; this.input.active = false; this.input.clear(); this.stepper.reset();
    this.sim = new ArenaSim({ ...this.options(), fighters: [0, 1], stage: 0 });
    this.sim.fighters[0].x = this.sim.fighters[0].prevX = 1.2; this.sim.fighters[1].x = this.sim.fighters[1].prevX = 5.2;
    this.view.setMatch([0, 1], 0); this.view.setDebug(false);
    this.ui.innerHTML = `<div class="screen hero"><header class="topbar">${brand}<div class="topbar-right"><span class="caps muted"><i class="status-dot"></i>OFFLINE / LOCAL MULTIPLAYER</span>${button('mute', this.settings.muted ? 'SOUND OFF' : 'SOUND ON')}</div></header>
      <main class="hero-copy"><div class="eyebrow">BAY AREA EGOS. ARCADE RULES.</div><h1>Big ideas.<br>Bigger<br><em>knockback.</em></h1><p class="hero-description">Take your rivalry to the rooftop.<br>Six disruptors. Three arenas. One last stock.</p><div class="hero-actions">${button('enter', 'ENTER THE ARENA', true)}${button('how', 'HOW TO PLAY')}${this.onlineHomeAction()}</div><div class="hero-features">3D PLATFORM FIGHTING &nbsp; / &nbsp; 1–2 PLAYERS</div></main>
      <div class="location-tag"><span class="caps">01 / MOUNTAIN VIEW, CALIFORNIA</span><strong>Castro Street</strong><span class="caps">THE COFFEE IS $9. THE BEEF IS FREE.</span></div><footer class="bottom-strip"><b>MOVE FAST. BREAK FRIENDSHIPS.</b><span>KEYBOARD + CONTROLLER</span><span class="edition">ARENA EDITION / 01</span></footer></div>`;
    this.bind('enter', () => { this.audio.unlock(); this.selection(); }); this.bind('how', () => this.controls(() => this.home())); this.bind('online', () => { this.audio.unlock(); this.openOnline(); }); this.bind('mute', () => this.toggleMute());
  }
  selection() {
    this.screen = 'select'; this.paused = false; this.modalReturn = null; this.input.active = false; this.input.clear(); this.view.setDebug(false);
    const selected = ROSTER[this.picks[this.activeSlot]], opponentLabel = this.mode === 'versus' ? 'PLAYER 2' : this.mode === 'training' ? 'DUMMY' : 'CPU';
    this.ui.innerHTML = `<div class="screen select-screen"><header class="topbar">${brand}<div class="topbar-right"><span class="caps muted">BUILD YOUR MATCH</span>${button('back', '← BACK')}</div></header>
      <main class="select-layout"><section><h2 class="select-heading">Choose your disruptor.</h2><div class="caps muted">ORIGINAL ROSTER / SIX VERY DIFFERENT EGOS</div>
      <div class="selection-tabs"><button class="selection-tab ${this.activeSlot === 0 ? 'active' : ''}" id="slot0">PLAYER 1<strong>${ROSTER[this.picks[0]].name}</strong></button><button class="selection-tab p2 ${this.activeSlot === 1 ? 'active' : ''}" id="slot1" ${this.mode === 'arcade' ? 'disabled' : ''}>${this.mode === 'arcade' ? 'ARCADE LADDER' : opponentLabel}<strong>${this.mode === 'arcade' ? 'Road to Elon' : ROSTER[this.picks[1]].name}</strong></button></div>
      <div class="roster">${ROSTER.map((f, i) => `<button class="fighter-card ${this.picks[this.activeSlot] === i ? 'selected' : ''}" style="--accent:${FIGHTER_ACCENTS[i]}" data-fighter="${i}" aria-label="Select ${f.name}, ${ROLES[i].toLowerCase()}" aria-pressed="${this.picks[this.activeSlot] === i}"><img src="${this.portraits[i]}" alt="3D ${f.name}"><span class="role">${ROLES[i]}</span><div class="fighter-info"><strong>${f.name}</strong><small>${f.profession}</small></div>${this.picks[0] === i ? '<span class="player-chip">P1</span>' : ''}${this.picks[1] === i && this.mode !== 'arcade' ? `<span class="player-chip second" style="${this.picks[0] === i ? 'top:32px' : ''}">${opponentLabel}</span>` : ''}</button>`).join('')}</div>
      <div class="fighter-detail"><p>“${selected.tagline}”</p><span class="special-name">B / ${SPECIAL_NAMES[this.picks[this.activeSlot]]}</span></div><div class="fighter-detail">${button('moves-btn', 'MOVE LIST + COMBOS')}</div></section>
      <aside class="setup-panel"><h3>MATCH SETTINGS</h3><label class="field">MODE<select id="mode"><option value="cpu">Quick match · vs CPU</option><option value="versus">Local versus · 2 players</option><option value="arcade">Arcade · road to Elon</option><option value="training">Training · practice freely</option></select></label>
      <label class="field">CPU DIFFICULTY<select id="difficulty"><option value="0">Intern · relaxed</option><option value="1">Founder · standard</option><option value="2">Board member · hard</option></select></label>
      <label class="field">GRAPHICS<select id="quality">${QUALITY_TIERS.map(t => `<option value="${t}">${QUALITY[t].label}</option>`).join('')}</select><small class="field-hint" id="quality-hint">${QUALITY[this.settings.quality].blurb}</small></label>
      <div class="field">ARENA<div class="stage-list">${STAGE_NAMES.map((s, i) => `<button class="stage-option ${this.stage === i ? 'selected' : ''}" data-stage="${i}" aria-pressed="${this.stage === i}"><span><strong>${s}</strong><small>${STAGE_TAGS[i]}</small></span><span class="stage-icon">${['☕', '◇', '↟'][i]}</span></button>`).join('')}</div></div>
      <label class="checkbox-row">Coffee + GPU pickups<input id="items" type="checkbox" ${this.settings.items ? 'checked' : ''}></label><label class="checkbox-row">Reduced motion<input id="reduced" type="checkbox" ${this.settings.reducedMotion ? 'checked' : ''}></label><label class="checkbox-row">Camera shake<input id="shake" type="checkbox" ${this.settings.cameraShake ? 'checked' : ''}></label><label class="checkbox-row">Original synth soundtrack<input id="music" type="checkbox" ${this.settings.music ? 'checked' : ''}></label>
      <div class="match-summary">${this.mode === 'training' ? 'UNLIMITED STOCKS / NO TIMER' : '3 STOCKS / 5 MINUTES / RING-OUTS'}</div>${button('fight', this.mode === 'arcade' ? 'START THE CLIMB' : 'LET’S SMACKDOWN', true)}</aside></main></div>`;
    (document.getElementById('mode') as HTMLSelectElement).value = this.mode;
    (document.getElementById('difficulty') as HTMLSelectElement).value = String(this.settings.difficulty);
    (document.getElementById('quality') as HTMLSelectElement).value = this.settings.quality;
    (document.getElementById('difficulty') as HTMLSelectElement).disabled = this.mode === 'versus' || this.mode === 'training';
    this.bind('back', () => this.home()); this.bind('slot0', () => { this.activeSlot = 0; this.selection(); }); this.bind('slot1', () => { this.activeSlot = 1; this.selection(); });
    this.bind('moves-btn', () => this.moveList(() => this.selection(), this.picks[this.activeSlot]));
    for (const card of this.ui.querySelectorAll<HTMLButtonElement>('[data-fighter]')) card.onclick = () => { this.picks[this.activeSlot] = Number(card.dataset.fighter); this.selection(); };
    for (const card of this.ui.querySelectorAll<HTMLButtonElement>('[data-stage]')) card.onclick = () => { this.stage = Number(card.dataset.stage); this.selection(); };
    document.getElementById('mode')!.onchange = e => { this.mode = (e.target as HTMLSelectElement).value as Mode; if (this.mode === 'arcade') this.activeSlot = 0; this.selection(); };
    document.getElementById('difficulty')!.onchange = e => { this.settings.difficulty = Number((e.target as HTMLSelectElement).value); this.save(); };
    document.getElementById('items')!.onchange = e => { this.settings.items = (e.target as HTMLInputElement).checked; this.save(); };
    document.getElementById('quality')!.onchange = e => { this.settings.quality = (e.target as HTMLSelectElement).value as QualityTier; this.view.setQuality(this.settings.quality); document.getElementById('quality-hint')!.textContent = QUALITY[this.settings.quality].blurb; this.save(); };
    document.getElementById('reduced')!.onchange = e => { this.settings.reducedMotion = (e.target as HTMLInputElement).checked; this.view.setReducedMotion(this.settings.reducedMotion); this.save(); };
    document.getElementById('shake')!.onchange = e => { this.settings.cameraShake = (e.target as HTMLInputElement).checked; this.view.setCameraShake(this.settings.cameraShake); this.save(); };
    document.getElementById('music')!.onchange = e => { this.settings.music = (e.target as HTMLInputElement).checked; this.audio.music = this.settings.music; this.save(); };
    this.bind('fight', () => { this.audio.unlock(); if (this.mode === 'arcade') { this.ladder = [0, 1, 2, 3, 4].filter(c => c !== this.picks[0]).concat(5); this.ladderIndex = 0; this.picks[1] = this.ladder[0]; } this.launch(); });
  }
  launch(options?: Partial<MatchOptions>) {
    if (options?.fighters) this.picks = [...options.fighters]; if (options?.stage !== undefined) this.stage = options.stage; if (options?.mode) this.mode = options.mode;
    this.sim = new ArenaSim({ ...this.options(), ...options }); this.view.setMatch(this.picks, this.stage);
    const practice = this.mode === 'training';
    this.sim.dummy = practice ? this.training.dummy : 'idle'; this.view.setDebug(practice && this.training.boxes);
    this.screen = 'match'; this.paused = false; this.modalReturn = null; this.input.clear(); this.input.active = true;
    this.stepper.reset(); this.last = 0; this.visualTime = 0; this.goTime = 0; this.resultDelay = 0; this.stepRequests = 0; this.comboUntil = [0, 0]; this.lastCommands = null;
    this.renderHud();
  }
  private renderHud() {
    const practice = this.mode === 'training';
    const online = !!this.netMatch;
    const slotLabel = (i: number) => online ? (i === (this.netView?.slot ?? 0) ? 'YOU' : 'OPP') : i ? this.mode === 'versus' ? 'P2' : practice ? 'DUMMY' : 'CPU' : 'P1';
    this.ui.innerHTML = `<div class="hud"><div class="hud-top">${brand}<div class="hud-actions">${practice ? button('reset', 'RESET') : ''}${button('hud-mute', this.settings.muted ? 'SOUND OFF' : 'SOUND ON')}${button('pause', 'PAUSE / ESC')}</div></div>
      <div class="clock"><strong id="timer">5:00</strong><small>${this.mode === 'arcade' ? `ARCADE ${this.ladderIndex + 1}/${this.ladder.length} · ` : ''}${STAGE_NAMES[this.stage].toUpperCase()}</small></div>
      ${this.sim.fighters.map((f, i) => `<div class="player-hud ${i ? 'p2' : ''}" style="--accent:${FIGHTER_ACCENTS[f.character]}"><img class="hud-portrait" src="${this.portraits[f.character]}" alt=""><div class="hud-info"><div class="hud-name"><span class="slot-label">${slotLabel(i)}</span>${ROSTER[f.character].name.toUpperCase()}</div><div class="percent" id="damage${i}">0<small>%</small></div><div class="stocks" id="stocks${i}"></div><div class="shield-track"><i id="shield${i}" style="width:100%"></i></div><div class="badge-buff" id="buff${i}"></div></div></div><div class="combo-pop ${i ? 'p2' : ''}" id="combo${i}"></div><div class="floating-marker ${i ? 'p2' : ''}" id="marker${i}">${slotLabel(i)}</div>`).join('')}
      <div class="hud-keys"><div><kbd>WASD</kbd> MOVE &nbsp; <kbd>V</kbd> ATTACK &nbsp; <kbd>B</kbd> SPECIAL</div><div><kbd>N</kbd> SHIELD &nbsp; <kbd>M</kbd> GRAB / THROW &nbsp; <kbd>W+B</kbd> RECOVER</div><div class="tiny">${online ? 'ONLINE: PLAYER 1 KEYS ON EACH MACHINE' : this.mode === 'versus' ? 'P2: ARROWS + J / K / L / ;' : 'MORE DAMAGE = BIGGER KNOCKBACK'}</div></div>
      ${online ? '<div class="net-pill" id="net-pill">CONNECTING</div>' : ''}
      <div class="grab-hint" id="hint"></div><div class="center-message" id="center"></div><div class="match-toast" id="toast" style="opacity:0"></div>
      ${practice ? this.trainingPanel() : ''}</div>`;
    this.hud = [0, 1].map(i => ({ damage: document.getElementById(`damage${i}`)!, stocks: document.getElementById(`stocks${i}`)!, shield: document.getElementById(`shield${i}`)!, marker: document.getElementById(`marker${i}`)!, buff: document.getElementById(`buff${i}`)!, combo: document.getElementById(`combo${i}`)!, last: { damage: 0, color: '', shield: -1, buff: '', stocks: '', marker: '', hidden: false, edge: false } }));
    this.lastCenter = ''; this.lastTimer = ''; this.toastOpacity = '';
    this.timer = document.getElementById('timer'); this.center = document.getElementById('center'); this.toast = document.getElementById('toast'); this.hint = document.getElementById('hint'); this.readout = document.getElementById('t-readout');
    this.bind('pause', () => { if (this.netMatch) this.toggleOnlineOverlay(); else this.togglePause(); }); this.bind('hud-mute', () => this.toggleMute()); this.bind('reset', () => { if (!this.netMatch) this.launch(); });
    if (practice) this.bindTraining();
  }
  private trainingPanel() {
    const t = this.training, dummies: [DummyMode, string][] = [['idle', 'Stands still'], ['shield', 'Shields'], ['jump', 'Jumps'], ['diLeft', 'DI left'], ['diRight', 'DI right'], ['tech', 'Techs grabs']];
    return `<div class="training" id="training"><div class="caps">TRAINING TOOLS</div>
      <label class="field">DUMMY<select id="t-dummy">${dummies.map(([v, label]) => `<option value="${v}" ${t.dummy === v ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
      <div class="caps tiny-caps">DUMMY DAMAGE</div><div class="row">${[0, 50, 100, 150].map(p => `<button id="t-p${p}" class="ghost-btn">${p}%</button>`).join('')}</div>
      <div class="row"><button id="t-reset-pos" class="ghost-btn">RESET POSITIONS</button><button id="t-heal" class="ghost-btn">HEAL BOTH</button></div>
      <label class="check"><input type="checkbox" id="t-boxes" ${t.boxes ? 'checked' : ''}>Show hitboxes <i class="legend hurt"></i><i class="legend hit"></i></label>
      <label class="check"><input type="checkbox" id="t-info" ${t.info ? 'checked' : ''}>Show state + inputs</label>
      <label class="check"><input type="checkbox" id="t-step" ${t.step ? 'checked' : ''}>Frame step (press <kbd>.</kbd>)</label>
      <div class="row"><button id="t-next" class="ghost-btn">NEXT FRAME</button><button id="t-moves" class="ghost-btn">MOVE LIST</button></div>
      <div class="tiny-note">P2 keys still move the dummy. ${THROW_HINT.p1}.</div></div><pre class="readout" id="t-readout"></pre>`;
  }
  private bindTraining() {
    const on = (id: string, fn: (el: HTMLElement) => void) => {
      const el = document.getElementById(id); if (!el) return;
      el.addEventListener(el instanceof HTMLSelectElement || el instanceof HTMLInputElement ? 'change' : 'click', () => { fn(el); (document.activeElement as HTMLElement | null)?.blur(); });
    };
    on('t-dummy', el => { this.training.dummy = (el as HTMLSelectElement).value as DummyMode; this.sim.dummy = this.training.dummy; });
    for (const pct of [0, 50, 100, 150]) on(`t-p${pct}`, () => { this.sim.setDamage(1, pct); this.updateHud(0); });
    on('t-reset-pos', () => { this.sim.resetPositions(); this.sim.clearInputs(); });
    on('t-heal', () => { this.sim.setDamage(0, 0); this.sim.setDamage(1, 0); this.updateHud(0); });
    on('t-boxes', el => { this.training.boxes = (el as HTMLInputElement).checked; this.view.setDebug(this.training.boxes); });
    on('t-info', el => { this.training.info = (el as HTMLInputElement).checked; if (!this.training.info && this.readout) this.readout.textContent = ''; });
    on('t-step', el => { this.training.step = (el as HTMLInputElement).checked; this.stepRequests = 0; this.stepper.reset(); });
    on('t-next', () => { if (this.training.step) this.stepRequests++; });
    on('t-moves', () => { this.togglePause(true); this.moveList(() => this.pauseMenu(), this.picks[0]); });
  }
  private updateHud(dt: number) {
    if (!this.timer || !this.center) return;
    const timer = this.mode === 'training' ? '∞' : formatTime(this.sim.remaining);
    if (timer !== this.lastTimer) { this.timer.textContent = timer; this.lastTimer = timer; }
    const { width, height } = this.view.size;
    for (let i = 0; i < 2; i++) {
      const f = this.sim.fighters[i], hud = this.hud[i], last = hud.last, dmg = Math.floor(f.damage);
      if (dmg !== last.damage) {
        hud.damage.innerHTML = `${dmg}<small>%</small>`;
        // A small, short bump when damage goes up (not on a heal or reset); skipped with reduced motion.
        if (dmg > last.damage && !this.settings.reducedMotion) hud.damage.animate([{ transform: 'scale(1.14)' }, { transform: 'scale(1)' }], { duration: 170, easing: 'ease-out' });
        last.damage = dmg;
      }
      const color = f.damage >= 140 ? '#ff7666' : f.damage >= 80 ? '#ffc181' : '#f4f4db';
      if (color !== last.color) { hud.damage.style.color = color; last.color = color; }
      const stocks = this.mode === 'training' ? '<span class="caps muted">PRACTICE</span>' : [0, 1, 2].map(s => `<i class="stock ${s >= f.stocks ? 'lost' : ''}"></i>`).join('');
      if (stocks !== last.stocks) { hud.stocks.innerHTML = stocks; last.stocks = stocks; }
      const shield = Math.round(f.shield * 2) / 2;
      if (shield !== last.shield) { hud.shield.style.width = `${shield}%`; last.shield = shield; }
      const buff = f.buff ? `GPU OVERCLOCK / ${Math.ceil(f.buff / 60)}s` : f.respawn ? 'RESPAWNING…' : '';
      if (buff !== last.buff) { hud.buff.textContent = buff; last.buff = buff; }
      // The label follows the fighter's drawn position (the same one the model, camera and shadow use) and, when the
      // fighter is out of view, sticks to the edge of the screen with an arrow pointing toward them.
      const hidden = f.respawn > 0 || f.stocks <= 0;
      if (hidden !== last.hidden) { hud.marker.style.display = hidden ? 'none' : 'block'; last.hidden = hidden; }
      if (!hidden) {
        const p = this.view.anchor(i, 2.9), x = Math.max(22, Math.min(width - 22, p.x)), y = Math.max(95, Math.min(height - 145, p.y));
        const edge = Math.abs(x - p.x) > 1 || Math.abs(y - p.y) > 1, transform = `translate3d(${Math.round(x * 2) / 2}px,${Math.round(y * 2) / 2}px,0) translate(-50%,-100%)`;
        if (transform !== last.marker) { hud.marker.style.transform = transform; last.marker = transform; }
        if (edge !== last.edge) { hud.marker.classList.toggle('edge', edge); last.edge = edge; }
        if (edge) hud.marker.style.setProperty('--angle', `${Math.atan2(p.y - y, p.x - x)}rad`);
      }
      if (this.comboUntil[i] > 0 && this.comboUntil[i] !== Infinity && (this.comboUntil[i] -= dt) <= 0) { hud.combo.className = `combo-pop ${i ? 'p2' : ''}`; hud.combo.textContent = ''; }
    }
    // Countdown / GO / empty text is rewritten only when it actually changes (the old code rebuilt it every frame).
    let center = '';
    if (this.sim.countdown > 0) center = `${Math.ceil(this.sim.countdown / 60)}<small>${this.sim.suddenDeath ? 'SUDDEN DEATH / 150%' : 'GET READY TO DISRUPT'}</small>`;
    else if (this.goTime > 0) { center = 'SMACKDOWN!'; this.goTime -= dt; }
    if (center !== this.lastCenter) { this.center.innerHTML = center; this.lastCenter = center; }
    this.toastTime -= dt;
    const opacity = this.toastTime > 0 ? '1' : '0';
    if (this.toast && opacity !== this.toastOpacity) { this.toast.style.opacity = opacity; this.toastOpacity = opacity; }
    this.updateHint(); this.updateReadout();
  }
  /** Contextual throw help: only while someone is holding or being held, and always in training. Updated on change only. */
  private updateHint() {
    if (!this.hint) return;
    if (this.netMatch) {
      let text = '', live = false;
      for (const fighter of this.sim.fighters) if (fighter.hold) { text = THROW_HINT.p1; live = true; break; }
      if (!live) for (const fighter of this.sim.fighters) if (fighter.heldBy !== null) { text = 'Tap M now to break the grab!'; live = true; break; }
      if (this.hint.textContent !== text) this.hint.textContent = text;
      this.hint.classList.toggle('live', live); this.hint.style.display = text ? 'block' : 'none';
      return;
    }
    const human = (slot: number) => slot === 0 || this.mode === 'versus' || this.mode === 'training';
    let text = '', live = false;
    for (const f of this.sim.fighters) if (f.hold && human(f.slot)) { text = f.slot ? THROW_HINT.p2 : THROW_HINT.p1; live = true; break; }
    if (!live) for (const f of this.sim.fighters) if (f.heldBy !== null && human(f.slot)) { text = f.slot ? 'Tap ; now to break the grab!' : 'Tap M now to break the grab!'; live = true; break; }
    if (!text && this.mode === 'training') text = THROW_HINT.p1;
    if (this.hint.textContent !== text) this.hint.textContent = text;
    this.hint.classList.toggle('live', live); this.hint.style.display = text ? 'block' : 'none';
  }
  private updateReadout() {
    if (!this.readout || !this.training.info || this.mode !== 'training') return;
    const [a, b] = this.sim.fighters, c = this.lastCommands;
    const line = (label: string, f: Fighter, keys: string) => `${label} ${stateLabel(f)} | ${Math.floor(f.damage)}% | combo ${f.combo}${f.combo ? ` (${Math.round(f.comboDamage)}%)` : ''} | ${keys}`;
    const text = `${line('P1   ', a, c ? keyGlyphs(c[0]) : '·')}\n${line('DUMMY', b, c ? keyGlyphs(c[1]) : '·')}`;
    if (this.readout.textContent !== text) this.readout.textContent = text;
  }
  private showToast(message: string) { if (this.toast && this.toast.isConnected) { this.toast.textContent = message; this.toastTime = 2; } }
  private showCombo(slot: number, hits: number, damage: string, done: boolean) {
    const el = this.hud[slot]?.combo; if (!el) return;
    el.className = `combo-pop ${slot ? 'p2' : ''} ${done ? 'done' : 'live'} ${done && hits >= 3 ? 'finisher' : ''}`;
    const html = `${hits} HITS<small>${damage}%${done ? ' · COMBO' : ''}</small>`; if (el.innerHTML !== html) el.innerHTML = html;
    this.comboUntil[slot] = done ? 1.5 : Infinity;
  }
  private togglePause(force?: boolean) {
    if (this.netMatch || this.screen !== 'match' || this.sim.finished) return;
    this.paused = force ?? !this.paused; this.input.clear(); this.stepper.reset(); this.sim.clearInputs();
    if (!this.paused) { this.ui.querySelector('.overlay')?.remove(); this.input.active = true; this.audio.unlock(); return; }
    this.input.active = false; this.pauseMenu();
  }
  private pauseMenu() {
    this.ui.querySelector('.overlay')?.remove(); this.modalReturn = null;
    const overlay = document.createElement('div'); overlay.className = 'overlay';
    overlay.innerHTML = `<section class="modal"><div class="caps">QUICK COFFEE BREAK</div><h2>Let’s circle back.</h2><p>The match is paused. Your runway can wait.</p><div class="modal-actions">${button('resume', 'BACK TO THE FIGHT', true)}${button('retry', 'RESTART MATCH')}${button('help', 'CONTROLS')}${button('moves', 'MOVE LIST')}${button('quit', 'CHARACTER SELECT')}</div><div class="modal-actions">${button('pause-mute', this.settings.muted ? 'SOUND OFF' : 'SOUND ON')}${button('fullscreen', 'FULLSCREEN')}${this.mode === 'training' ? button('dummy-damage', 'DUMMY +50%') : ''}</div></section>`;
    this.ui.append(overlay); this.bind('resume', () => this.togglePause(false)); this.bind('retry', () => this.launch()); this.bind('quit', () => this.selection());
    this.bind('help', () => this.controls(() => this.pauseMenu())); this.bind('moves', () => this.moveList(() => this.pauseMenu(), this.picks[0]));
    this.bind('pause-mute', () => this.toggleMute()); this.bind('fullscreen', () => this.fullscreen());
    this.bind('dummy-damage', () => { this.sim.fighters[1].damage = Math.min(999, this.sim.fighters[1].damage + 50); this.updateHud(0); });
    document.getElementById('resume')?.focus();
  }
  private controls(back: () => void) {
    this.ui.querySelector('.overlay')?.remove(); this.modalReturn = back;
    const overlay = document.createElement('div'); overlay.className = 'overlay';
    overlay.innerHTML = `<section class="modal"><div class="caps">YOUR QUICK START</div><h2>Send them out of office.</h2><p>Build your opponent’s damage, then launch them past the edge. Higher percentages fly farther. Last fighter with stocks wins.</p><table class="control-table"><thead><tr><th>ACTION</th><th>PLAYER 1</th><th>PLAYER 2</th><th>CONTROLLER*</th></tr></thead><tbody>
      <tr><td>Move</td><td>A / D</td><td>← / →</td><td>Left stick / D-pad</td></tr><tr><td>Jump / double jump</td><td>W or Space</td><td>↑</td><td>A / D-pad up</td></tr><tr><td>Jab string (tap three times)</td><td>V, V, V</td><td>J, J, J</td><td>X, X, X</td></tr><tr><td>Strong directional attack</td><td>Direction + V</td><td>Direction + J</td><td>Direction + X</td></tr><tr><td>Aerials: neutral / forward / back / up / down</td><td>V in the air, plus a direction</td><td>J in the air, plus a direction</td><td>X in the air, plus a direction</td></tr><tr><td>Signature projectile</td><td>B</td><td>K (or 5)</td><td>B</td></tr><tr><td>Rising recovery</td><td>Hold W + tap B</td><td>Hold ↑ + tap K</td><td>Stick up + B</td></tr><tr><td>Down special (slam, counter or dash)</td><td>S + B</td><td>↓ + K</td><td>Down + B</td></tr><tr><td>Fast fall / drop through a platform</td><td>hold S</td><td>hold ↓</td><td>hold down</td></tr><tr><td>Shield / dodge roll</td><td>N / N + A or D</td><td>L / L + ← or →</td><td>LT / LT + direction</td></tr><tr><td>Grab (works from shield, beats it)</td><td>M</td><td>; (or +)</td><td>Y</td></tr><tr><td>Throw (while holding)</td><td>M + direction (none = forward)</td><td>; + direction</td><td>Y + direction</td></tr><tr><td>Pummel (while holding, twice)</td><td>V</td><td>J</td><td>X</td></tr><tr><td>Break a grab (first 8 frames)</td><td>tap M</td><td>tap ;</td><td>tap Y</td></tr></tbody></table>
      <p class="control-note">Jump twice, then use <b>up + special</b> to return to the stage; it works once until you land. Rolls stop at the edge of a platform. Coffee removes 22% damage; a GPU boosts attacks for 8 seconds. Holding shield too long breaks it. Esc pauses, F enters fullscreen, O mutes.</p><p class="control-note">A grab catches first and only damages when you throw. The caught fighter can tap grab in the first 8 frames to break it. Hits that keep the opponent in hitstun count as a combo; the counter appears beside your damage. Open the move list for every move’s frames and each fighter’s verified routes.</p><p class="control-note">*Standard Xbox-style button names. Connect a controller and press a button to activate it; the first two detected controllers control P1 and P2. Keyboard works at the same time. Training leaves P2 still; P2 keys can move the dummy.</p><div class="modal-actions">${button('close-controls', 'GOT IT', true)}</div></section>`;
    this.ui.append(overlay); this.bind('close-controls', () => { this.modalReturn = null; overlay.remove(); back(); }); document.getElementById('close-controls')?.focus();
  }
  /** Every move with frame data, plus each fighter's verified routes, generated from the simulation's own data. */
  private moveList(back: () => void, fighter = 0) {
    this.ui.querySelector('.overlay')?.remove(); this.modalReturn = back;
    const f = ROSTER[fighter], rows = describeMoves(fighter), combos = describeCombos(fighter), groups = ['Normal', 'Aerial', 'Special', 'Grab and throws'] as const;
    const overlay = document.createElement('div'); overlay.className = 'overlay';
    overlay.innerHTML = `<section class="modal wide"><div class="caps">MOVE LIST / FRAME DATA</div><h2>${f.name} · ${f.profession}</h2>
      <div class="tabs">${ROSTER.map((r, i) => `<button class="ghost-btn ${i === fighter ? 'active' : ''}" data-fighter-tab="${i}">${r.name}</button>`).join('')}</div>
      ${groups.map(g => `<h3 class="move-group">${g}</h3><table class="control-table moves"><thead><tr><th>MOVE</th><th>INPUT (P1)</th><th>START</th><th>ACTIVE</th><th>END</th><th>DMG</th><th>NOTES</th></tr></thead><tbody>${rows.filter(r => r.group === g).map(r => `<tr><td>${r.name}</td><td>${r.input}</td><td>${r.startup}</td><td>${r.active}</td><td>${r.endlag}</td><td>${r.damage}</td><td>${r.note}</td></tr>`).join('')}</tbody></table>`).join('')}
      <h3 class="move-group">Combos and routes</h3><table class="control-table combos"><thead><tr><th>ROUTE</th><th>INPUTS (P1)</th><th>TYPE</th><th>WORKS</th><th>NOTES</th></tr></thead><tbody>${combos.map(c => `<tr><td>${c.name}</td><td>${c.inputs}</td><td><span class="badge ${c.kind}">${c.kind === 'true' ? 'TRUE COMBO' : c.kind === 'pressure' ? 'PRESSURE' : 'READ'}</span></td><td>${describeBand(c)}</td><td>${c.note}</td></tr>`).join('')}</tbody></table>
      <p class="control-note">Frames are 60 per second. START is the first active frame; END is recovery after the last active frame. “→” means toward the opponent. A true combo leaves the defender no chance to act between hits; percentages are for an average-weight defender, and heavier or lighter fighters differ.</p>
      <div class="modal-actions">${button('close-moves', 'GOT IT', true)}</div></section>`;
    this.ui.append(overlay); this.bind('close-moves', () => { this.modalReturn = null; overlay.remove(); back(); });
    for (const tab of overlay.querySelectorAll<HTMLButtonElement>('[data-fighter-tab]')) tab.onclick = () => this.moveList(back, Number(tab.dataset.fighterTab));
    document.getElementById('close-moves')?.focus();
  }
  private results() {
    this.screen = 'result'; this.input.active = false; this.input.clear(); this.sim.clearInputs(); this.view.setDebug(false);
    const winner = this.sim.fighters[this.sim.winner], humanWon = this.sim.winner === 0;
    const next = this.mode === 'arcade' && humanWon && this.ladderIndex < this.ladder.length - 1;
    const champion = this.mode === 'arcade' && humanWon && !next;
    const title = champion ? 'The Valley is yours.' : `${ROSTER[winner.character].name} takes the round.`;
    const overlay = document.createElement('div'); overlay.className = 'overlay';
    overlay.innerHTML = `<section class="modal results-modal"><div class="caps">${champion ? 'ARCADE COMPLETE / FOUNDER STATUS' : 'MARKET DISRUPTED / MATCH COMPLETE'}</div><h2>${title}</h2><div class="result-winner"><img src="${this.portraits[winner.character]}" alt="${ROSTER[winner.character].name}"><div><strong>${ROSTER[winner.character].name}</strong><div class="result-stats"><span>${winner.stocks}</span> STOCK${winner.stocks === 1 ? '' : 'S'} REMAINING<br><span>${Math.floor(winner.damage)}%</span> FINAL DAMAGE<br>${formatTime(5 * 60 * 60 - this.sim.remaining)} ELAPSED</div></div></div><p>“${ROSTER[winner.character].winLine}”</p><div class="modal-actions">${button('rematch', next ? 'NEXT CHALLENGER' : this.mode === 'arcade' && !humanWon ? 'TRY AGAIN' : 'REMATCH', true)}${button('select-again', 'CHARACTER SELECT')}${button('home', 'MAIN MENU')}</div></section>`;
    this.ui.append(overlay);
    this.bind('rematch', () => {
      if (next) { this.ladderIndex++; this.picks[1] = this.ladder[this.ladderIndex]; this.stage = this.ladderIndex % 3; }
      else if (champion) { this.ladderIndex = 0; this.picks[1] = this.ladder[0]; }
      this.launch();
    });
    this.bind('select-again', () => this.selection()); this.bind('home', () => this.home()); document.getElementById('rematch')?.focus();
  }
  /** Runs one simulation tick with this tick's input and handles the events it produced. Returns false if input paused the game. */
  private tick(): boolean {
    const commands = this.input.sample(); if (this.paused) return false;
    const before = this.sim.countdown; this.view.captureTick(this.sim); this.sim.step(commands); this.lastCommands = commands;
    if (before > 0 && !this.sim.countdown) this.goTime = 0.65;
    for (const event of this.sim.events) this.dispatchEvent(event);
    this.sim.events.length = 0;
    return true;
  }
  private dispatchEvent(event: GameEvent) {
    this.view.event(event, this.sim); this.audio.effect(event.type);
    if (event.type === 'ledge') this.view.snapFighter(event.slot);
    const name = ROSTER[this.sim.fighters[event.slot].character].name.toUpperCase();
    switch (event.type) {
      case 'pickup': this.showToast(event.text ?? 'PICKUP'); break;
      case 'break': this.showToast('SHIELD BROKEN!'); break;
      case 'ledge': this.showToast('BACK IN BUSINESS / LEDGE RECOVERY'); break;
      case 'tech': this.showToast(`${name} BREAKS THE GRAB!`); break;
      case 'throwBreak': this.showToast('THROW BREAK!'); break;
      case 'counter': this.showToast(`${name} / REBUTTAL!`); break;
      case 'ko': this.showToast(`${name} / OUT OF OFFICE`); this.comboUntil = [0, 0]; for (let i = 0; i < 2; i++) { this.hud[i].combo.className = `combo-pop ${i ? 'p2' : ''}`; this.hud[i].combo.textContent = ''; } break;
      case 'combo': this.showCombo(event.slot, event.value ?? 2, event.text ?? '0', false); break;
      case 'comboEnd': this.showCombo(event.slot, event.value ?? 2, event.text ?? '0', true); break;
      case 'hit': case 'pummel': case 'armor': {
        const point = this.view.project(event.x, event.y + 0.9), popup = document.createElement('div'); popup.className = `damage-pop${event.type === 'hit' ? '' : ' small'}`; popup.textContent = `+${Math.round(event.value ?? 0)}`;
        popup.style.left = `${point.x}px`; popup.style.top = `${point.y}px`; this.ui.append(popup); setTimeout(() => popup.remove(), 700); break;
      }
      default: break;
    }
  }
  private frame(now: number) {
    this.animationFrame = requestAnimationFrame(t => this.frame(t));
    const raw = this.last ? (now - this.last) / 1000 : 0; this.last = now;
    const dt = Math.min(0.08, raw);
    const online = !!this.netMatch && this.screen === 'match';
    if (!this.paused) this.visualTime += dt;
    const playing = this.screen === 'match' && !this.paused;
    const stepping = playing && this.mode === 'training' && this.training.step && !online;
    if (playing && !this.sim.finished && !online) {
      if (stepping) { this.stepper.reset(); while (this.stepRequests > 0 && !this.paused) { this.stepRequests--; this.tick(); } }
      else this.stepper.advance(dt, () => this.tick() ? undefined : false);
    }
    if (online && !this.netResult && !this.netInterrupted) this.pumpOnline(raw);
    if (playing && this.sim.finished && !online) { this.resultDelay += dt; if (this.resultDelay > 1) this.results(); }
    if (online && (this.netResult || this.netInterrupted)) { this.resultDelay += dt; if (this.resultDelay > 0.6 && this.screen === 'match') this.onlineResults(); }
    const menu = this.screen === 'home' || this.screen === 'select' || this.screen === 'lobby';
    const onlineAlpha = Math.min(1, this.netAccumulator / (1 / 60));
    this.view.render(this.sim, { dt, time: this.visualTime, menu, alpha: online ? onlineAlpha : this.paused || menu || this.sim.finished || stepping ? 1 : this.stepper.alpha, paused: this.paused, stepping });
    if (this.screen === 'match' || this.screen === 'result') this.updateHud(this.paused ? 0 : dt);
    if (online) this.updateNetPill();
    this.audio.update(playing && !this.sim.finished && !this.netInterrupted);
  }

  /** Online entry from the home screen. A room code in the address opens the join form. */
  openOnline(code?: string | null, autoJoin = false) {
    if (!onlineEnabled()) return;
    this.screen = 'lobby'; this.paused = false; this.modalReturn = null; this.input.active = false; this.input.clear();
    this.netStatus = 'Connecting…';
    this.netPending = autoJoin && code ? { t: 'join', code } : null;
    this.ui.innerHTML = onlineGateMarkup(brand, code ? code : '', this.netStatus, this.settings.muted ? 'SOUND OFF' : 'SOUND ON');
    this.bindOnlineGate();
    this.ensureNet();
  }

  installOnlineFixture(frames: Record<string, Partial<Controls>>) {
    if (!this.testMode) return;
    this.netFixture = new Map(Object.entries(frames).map(([frame, partial]) => [Number(frame), { ...noInput(), ...partial }]));
  }

  onlineDebug(frame?: number) {
    const session = this.netSession;
    const confirmed = session?.confirmed ?? 0;
    const at = typeof frame === 'number' ? frame : confirmed;
    return {
      tick: this.sim.tick, confirmed, hash: session?.hashAt(at) ?? null,
      waiting: session?.waiting ?? false, interrupted: session?.interrupted ?? this.netInterrupted,
      rtt: this.net?.rtt ?? null, epoch: this.netMatch?.epoch ?? 0, matchId: this.netMatch?.matchId ?? '',
      status: this.netView?.status ?? '', slot: this.netView?.slot ?? null,
    };
  }

  private onlineHomeAction(): string {
    if (onlineEnabled()) return button('online', 'ONLINE 1V1');
    const hosted = publicGameUrl();
    return hosted ? `<a class="ghost-btn" href="${hosted.replace(/"/g, '')}">PLAY ONLINE</a>` : '';
  }

  private ensureNet() {
    if (this.net) return;
    this.netWelcomed = false;
    this.netReconnects = 0;
    const client = new OnlineClient();
    client.onMessage = message => this.onNet(message);
    client.onClose = () => this.onNetClose();
    this.net = client;
    client.connect(relayUrl());
  }

  private shutdownNet() {
    this.net?.leave();
    this.net = null;
    this.netView = null;
    this.netMatch = null;
    this.netSession = null;
    this.netStarted = false;
    this.netOverlay = false;
    this.netResult = null;
    this.netInterrupted = null;
    this.netWelcomed = false;
    this.netPending = null;
    this.netResultSent = false;
    this.netAccumulator = 0;
  }

  private bindOnlineGate() {
    this.bind('back', () => this.home());
    this.bind('mute', () => this.toggleMute());
    this.bind('create-room', () => { this.netPending = 'create'; this.flushPending(); });
    this.bind('join-room', () => {
      const raw = (document.getElementById('join-code') as HTMLInputElement | null)?.value ?? '';
      this.netPending = { t: 'join', code: raw };
      this.flushPending();
    });
  }

  private flushPending() {
    if (!this.netWelcomed || !this.net || !this.netPending) return;
    const pending = this.netPending;
    this.netPending = null;
    if (pending === 'create') this.net.send({ t: 'create' });
    else this.net.send({ t: 'join', code: pending.code });
  }

  private onNet(message: ServerMessage) {
    switch (message.t) {
      case 'welcome': this.netWelcomed = true; this.netReconnects = 0; this.flushPending(); break;
      case 'room': this.onRoom(message.view); break;
      case 'prepare': this.onPrepare(message.match); break;
      case 'start': this.onStart(message); break;
      case 'inputs': this.onInputs(message); break;
      case 'hash': this.onHash(message); break;
      case 'result': this.netResult = message; this.resultDelay = 0; break;
      case 'abort': this.netInterrupted = message.reason; this.netSession?.interrupt(message.reason); this.resultDelay = 0; break;
      case 'error': this.netStatus = message.message || ERROR_TEXT[message.code]; this.setOnlineStatus(this.netStatus); break;
      default: break;
    }
  }

  private onNetClose() {
    if (!this.net || this.screen === 'home') return;
    if (this.net.session && this.netReconnects < 1 && this.netMatch) {
      this.netReconnects++;
      this.netStatus = 'Reconnecting…';
      this.setOnlineStatus(this.netStatus);
      this.net.connect(relayUrl(), true);
      return;
    }
    if (!this.netInterrupted && !this.netResult) {
      this.netInterrupted = 'disconnect';
      this.resultDelay = 0;
      if (this.screen === 'lobby') this.setOnlineStatus('The connection dropped.');
    }
  }

  private onRoom(view: RoomView) {
    this.netView = view;
    if (view.status === 'lobby') {
      this.netMatch = null;
      this.netSession = null;
      this.netStarted = false;
      this.netResult = null;
      this.netInterrupted = null;
      this.netResultSent = false;
      this.netOverlay = false;
      this.showLobby();
    }
  }

  private showLobby() {
    const view = this.netView;
    if (!view) return;
    this.screen = 'lobby';
    this.input.active = false;
    this.ui.innerHTML = lobbyMarkup({
      brand, view, names: ROSTER.map(f => f.name), portraits: this.portraits, accents: FIGHTER_ACCENTS, roles: ROLES,
      professions: ROSTER.map(f => f.profession), stageNames: STAGE_NAMES, stageTags: STAGE_TAGS,
      invite: inviteUrl(view.code), status: this.netStatus, soundLabel: this.settings.muted ? 'SOUND OFF' : 'SOUND ON',
      qualityOptions: QUALITY_TIERS.map(tier => `<option value="${tier}">${QUALITY[tier].label}</option>`).join(''),
      quality: this.settings.quality, reduced: this.settings.reducedMotion, shake: this.settings.cameraShake, music: this.settings.music,
    });
    const quality = document.getElementById('quality') as HTMLSelectElement | null;
    if (quality) quality.value = this.settings.quality;
    this.bind('mute', () => { this.toggleMute(); const label = this.settings.muted ? 'SOUND OFF' : 'SOUND ON'; const el = document.getElementById('mute'); if (el) el.textContent = label; });
    this.bind('leave-room', () => this.home());
    this.bind('copy-code', () => this.copyText((document.getElementById('room-code') as HTMLInputElement).value));
    this.bind('copy-link', () => this.copyText((document.getElementById('invite-link') as HTMLInputElement).value));
    this.bind('ready', () => { if (this.net && this.netView) this.net.send({ t: 'ready', rev: this.netView.rev, ready: !this.netView.ready[this.netView.slot] }); });
    for (const card of this.ui.querySelectorAll<HTMLButtonElement>('[data-fighter]')) card.onclick = () => {
      if (this.net && this.netView) this.net.send({ t: 'config', rev: this.netView.rev, fighter: Number(card.dataset.fighter) });
    };
    for (const card of this.ui.querySelectorAll<HTMLButtonElement>('[data-stage]')) card.onclick = () => {
      if (this.net && this.netView?.slot === 0) this.net.send({ t: 'config', rev: this.netView.rev, stage: Number(card.dataset.stage) });
    };
    const items = document.getElementById('items') as HTMLInputElement | null;
    if (items) items.onchange = () => { if (this.net && this.netView?.slot === 0) this.net.send({ t: 'config', rev: this.netView.rev, items: items.checked }); };
    this.bindLocalGraphics();
  }

  private bindLocalGraphics() {
    const quality = document.getElementById('quality');
    if (quality) quality.onchange = event => { this.settings.quality = (event.target as HTMLSelectElement).value as QualityTier; this.view.setQuality(this.settings.quality); this.save(); };
    const reduced = document.getElementById('reduced');
    if (reduced) reduced.onchange = event => { this.settings.reducedMotion = (event.target as HTMLInputElement).checked; this.view.setReducedMotion(this.settings.reducedMotion); this.save(); };
    const shake = document.getElementById('shake');
    if (shake) shake.onchange = event => { this.settings.cameraShake = (event.target as HTMLInputElement).checked; this.view.setCameraShake(this.settings.cameraShake); this.save(); };
    const music = document.getElementById('music');
    if (music) music.onchange = event => { this.settings.music = (event.target as HTMLInputElement).checked; this.audio.music = this.settings.music; this.save(); };
  }

  private onPrepare(match: MatchDescriptor) {
    this.netMatch = match;
    this.netSession = null;
    this.netStarted = false;
    this.netResult = null;
    this.netInterrupted = null;
    this.netResultSent = false;
    this.netOverlay = false;
    this.netAccumulator = 0;
    this.resultDelay = 0;
    this.launch({ fighters: [...match.fighters], stage: match.stage, mode: 'versus', items: match.items, seed: match.seed });
    this.net?.send({ t: 'loaded', matchId: match.matchId });
    this.setOnlineStatus('Loading the same match…');
  }

  private onStart(message: Extract<ServerMessage, { t: 'start' }>) {
    if (!this.netMatch || message.matchId !== this.netMatch.matchId || message.epoch !== this.netMatch.epoch || !this.netView) return;
    this.netStartAt = message.startAt;
    this.netStarted = false;
    this.netAccumulator = 0;
    this.netSession = new RollbackSession({
      sim: this.sim, localSlot: this.netView.slot, matchId: message.matchId, epoch: message.epoch, now: () => this.net?.now() ?? Date.now(),
    });
  }

  private onInputs(message: Extract<ServerMessage, { t: 'inputs' }>) {
    const session = this.netSession;
    if (!session || message.matchId !== session.matchId || message.epoch !== session.epoch) return;
    for (const frame of message.frames) {
      if (message.slot === session.localSlot) session.ackLocal(frame.n, frame.i);
      else session.pushRemote(frame.n, frame.i);
    }
  }

  private onHash(message: Extract<ServerMessage, { t: 'hash' }>) {
    const session = this.netSession;
    if (!session || message.matchId !== session.matchId || message.epoch !== session.epoch || message.slot === session.localSlot) return;
    session.noteRemoteHash(message.frame, message.hash);
  }

  private pumpOnline(rawDt: number) {
    const session = this.netSession;
    const match = this.netMatch;
    if (!session || !match || !this.net) return;
    if (!this.netStarted) {
      if (this.net.now() < this.netStartAt) return;
      this.netStarted = true;
      this.netAccumulator = 0;
    }
    const step = 1 / 60;
    this.netAccumulator += rawDt;
    let guard = 0;
    while (guard++ < 8 && this.netAccumulator >= step && !session.interrupted) {
      if (session.wantsLocal()) session.submitLocal(this.onlineControls());
      const status = session.stepOne({
        beforeLiveStep: sim => this.view.captureTick(sim),
        afterCorrection: () => this.view.correct(),
      });
      if (status !== 'stepped') { this.netAccumulator = Math.min(this.netAccumulator, step); break; }
      this.netAccumulator -= step;
    }
    this.flushSession(session, match);
    if (session.interrupted && !this.netInterrupted) this.failOnline(session.interrupted);
    else if (this.netAccumulator > 3) this.failOnline('stall');
  }

  private onlineControls(): Controls {
    const session = this.netSession;
    const scripted = session ? this.netFixture?.get(session.nextLocalFrame) : undefined;
    if (scripted) { this.input.pressed.clear(); return scripted; }
    if (this.netOverlay || !this.input.active) { this.input.pressed.clear(); return noInput(); }
    return this.input.sampleLocal();
  }

  private flushSession(session: RollbackSession, match: MatchDescriptor) {
    const frames = session.takeOutbound().map(packet => ({ n: packet.frame, i: packet.input }));
    if (frames.length) this.net?.send({ t: 'inputs', matchId: match.matchId, epoch: match.epoch, frames });
    const hash = session.takeHash();
    if (hash) this.net?.send({ t: 'hash', matchId: match.matchId, epoch: match.epoch, frame: hash.frame, hash: hash.hash });
    for (const event of session.drainEvents()) this.dispatchEvent(event.event);
    const result = session.confirmedResult();
    if (result && !this.netResultSent) {
      this.netResultSent = true;
      const winner = result.winner === 0 || result.winner === 1 ? result.winner : -1;
      this.net?.send({ t: 'result', matchId: match.matchId, epoch: match.epoch, frame: result.frame, winner, hash: result.hash });
    }
  }

  private failOnline(reason: string) {
    this.netInterrupted = reason;
    this.netSession?.interrupt(reason);
    this.resultDelay = 0;
    if (reason === 'stall') this.net?.drop();
  }

  private toggleOnlineOverlay() {
    if (this.screen !== 'match' || !this.netMatch) return;
    this.netOverlay = !this.netOverlay;
    this.ui.querySelector('.overlay')?.remove();
    if (!this.netOverlay) return;
    const overlay = document.createElement('div');
    overlay.className = 'overlay';
    overlay.innerHTML = `<section class="modal"><div class="caps">STILL LIVE</div><h2>The fight keeps going.</h2><p>This menu is only on your screen. Your fighter holds still until you come back. Esc returns to the match.</p><div class="modal-actions">${button('online-resume', 'BACK TO THE FIGHT', true)}${button('online-forfeit', 'FORFEIT MATCH')}${button('online-leave', 'LEAVE ROOM')}</div><div class="modal-actions">${button('help', 'CONTROLS')}${button('pause-mute', this.settings.muted ? 'SOUND OFF' : 'SOUND ON')}${button('fullscreen', 'FULLSCREEN')}</div></section>`;
    this.ui.append(overlay);
    this.bind('online-resume', () => this.toggleOnlineOverlay());
    this.bind('online-forfeit', () => { if (this.net && this.netMatch) this.net.send({ t: 'forfeit', matchId: this.netMatch.matchId, epoch: this.netMatch.epoch }); });
    this.bind('online-leave', () => this.home());
    this.bind('help', () => this.controls(() => { this.netOverlay = false; this.toggleOnlineOverlay(); }));
    this.bind('pause-mute', () => this.toggleMute());
    this.bind('fullscreen', () => this.fullscreen());
  }

  private onlineResults() {
    this.screen = 'result';
    this.netOverlay = false;
    this.input.active = false;
    this.ui.querySelector('.overlay')?.remove();
    const result = this.netResult;
    if (this.netInterrupted || !result || result.winner < 0) {
      const overlay = document.createElement('div');
      overlay.className = 'overlay';
      const reason = this.netInterrupted === 'desync' ? 'The two games disagreed, so nobody takes the win.'
        : this.netInterrupted === 'stall' ? 'The match fell too far behind, so the round was stopped with no winner.'
        : 'The connection dropped. Nobody takes the win.';
      overlay.innerHTML = `<section class="modal results-modal"><div class="caps">ROUND STOPPED</div><h2>No winner.</h2><p>${reason}</p><div class="modal-actions">${button('back-lobby', 'BACK TO LOBBY', true)}${button('home', 'MAIN MENU')}</div></section>`;
      this.ui.append(overlay);
      this.bind('back-lobby', () => { if (!this.net?.send({ t: 'lobby' })) this.home(); });
      this.bind('home', () => this.home());
      return;
    }
    const winner = result.winner as 0 | 1;
    const character = this.sim.fighters[winner].character;
    const title = result.reason === 'forfeit' ? `${ROSTER[character].name} wins by forfeit.` : `${ROSTER[character].name} takes the round.`;
    const overlay = document.createElement('div');
    overlay.className = 'overlay';
    overlay.innerHTML = `<section class="modal results-modal"><div class="caps">${result.reason === 'forfeit' ? 'FORFEIT' : 'MARKET DISRUPTED / MATCH COMPLETE'}</div><h2>${title}</h2><div class="result-winner"><img src="${this.portraits[character]}" alt=""><div><strong>${ROSTER[character].name}</strong></div></div><p>“${ROSTER[character].winLine}”</p><div class="modal-actions">${button('online-rematch', 'REMATCH', true)}${button('back-lobby', 'BACK TO LOBBY')}${button('home', 'LEAVE ROOM')}</div></section>`;
    this.ui.append(overlay);
    this.bind('online-rematch', () => { this.netResultSent = false; this.net?.send({ t: 'rematch' }); this.setOnlineStatus('Waiting for a rematch…'); });
    this.bind('back-lobby', () => { if (!this.net?.send({ t: 'lobby' })) this.home(); });
    this.bind('home', () => this.home());
  }

  private updateNetPill() {
    const pill = document.getElementById('net-pill');
    if (!pill || !this.net) return;
    const rtt = this.net.rtt === null ? '' : ` ${Math.round(this.net.rtt)} ms`;
    const waiting = this.netSession?.waiting ? 'WAITING' : this.netStarted ? 'LIVE' : 'STARTING';
    const text = `${waiting}${rtt}`;
    if (pill.textContent !== text) pill.textContent = text;
    if (this.netSession?.waiting) this.showToast('WAITING FOR OPPONENT');
  }

  private setOnlineStatus(text: string) {
    this.netStatus = text;
    const el = document.getElementById('online-status');
    if (el) el.textContent = text;
  }

  private copyText(value: string) {
    const done = () => this.setOnlineStatus('Copied. The code field stays selectable if paste is blocked.');
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(value).then(done).catch(done);
    else done();
  }
}

export function startArena() {
  const app = document.getElementById('app')!;
  try { new ArenaApp(app); }
  catch (error) {
    console.error(error);
    app.innerHTML = '<div class="fatal"><div><h2>Let’s get the arena running.</h2><p>This game needs WebGL 2. Open it in a recent Chrome, Edge, or Firefox browser with hardware acceleration enabled, then reload.</p><p>If you are opening the downloaded ZIP, extract it first and open PLAY.html.</p><button class="primary-btn" id="fatal-reload">RELOAD GAME</button></div></div>';
    document.getElementById('fatal-reload')!.onclick = () => location.reload();
  }
}
