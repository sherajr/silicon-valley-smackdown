import './styles.css';
import { ArenaSim, newFighter } from './Simulation';
import type { MatchOptions, Mode } from './Simulation';
import { ArenaRenderer } from './Renderer';
import { ArenaInput } from './Input';
import { ArenaAudio } from './Audio';
import { ROSTER, STAGE_NAMES, STAGE_TAGS, FIGHTER_ACCENTS, SPECIAL_NAMES } from './data';

const brand = '<div class="brand"><span class="brand-mark">SV</span><span>Silicon Valley<br>Smackdown</span></div>';
const button = (id: string, label: string, primary = false) => `<button id="${id}" class="${primary ? 'primary-btn' : 'ghost-btn'}">${label}${primary ? '<span class="arrow">↗</span>' : ''}</button>`;
const formatTime = (ticks: number) => `${Math.floor(Math.ceil(ticks / 60) / 60)}:${String(Math.ceil(ticks / 60) % 60).padStart(2, '0')}`;
interface Settings { high: boolean; muted: boolean; music: boolean; difficulty: number; items: boolean }
const loadSettings = (): Settings => {
  const defaults: Settings = { high: true, muted: false, music: true, difficulty: 1, items: true };
  try { const saved = JSON.parse(localStorage.getItem('svs-arena-v1') ?? '{}'); for (const key of ['high', 'muted', 'music', 'items'] as const) if (typeof saved[key] === 'boolean') defaults[key] = saved[key]; if ([0, 1, 2].includes(saved.difficulty)) defaults.difficulty = saved.difficulty; } catch { /* Local files/private browsing may deny storage. */ }
  return defaults;
};

export class ArenaApp {
  sim: ArenaSim;
  view: ArenaRenderer;
  input = new ArenaInput();
  audio = new ArenaAudio();
  screen: 'home' | 'select' | 'match' | 'result' = 'home';
  paused = false;
  ui: HTMLDivElement;
  settings = loadSettings();
  private portraits: string[];
  private picks: [number, number] = [0, 1];
  private stage = 0;
  private mode: Mode = 'cpu';
  private activeSlot = 0;
  private accumulator = 0;
  private last = 0;
  private visualTime = 0;
  private toastTime = 0;
  private goTime = 0;
  private resultDelay = 0;
  private ladder: number[] = [];
  private ladderIndex = 0;
  private hud: { damage: HTMLElement; stocks: HTMLElement; shield: HTMLElement; marker: HTMLElement; buff: HTMLElement }[] = [];
  private timer: HTMLElement | null = null;
  private center: HTMLElement | null = null;
  private toast: HTMLElement | null = null;
  private modalReturn: (() => void) | null = null;
  private animationFrame = 0;

  constructor(container: HTMLElement) {
    container.innerHTML = '<div id="arena"><div id="arena-ui"></div></div>';
    const root = document.getElementById('arena')!; this.ui = document.getElementById('arena-ui') as HTMLDivElement;
    this.view = new ArenaRenderer(root); root.append(this.ui);
    this.portraits = this.view.portraits();
    this.sim = new ArenaSim(this.options()); this.view.setMatch(this.picks, 0);
    this.view.setQuality(this.settings.high); this.audio.setMute(this.settings.muted); this.audio.music = this.settings.music;
    this.input.onPause = () => {
      if (this.modalReturn) { const back = this.modalReturn; this.modalReturn = null; back(); }
      else if (this.screen === 'match') this.togglePause();
      else if (this.screen === 'select') this.home();
    };
    this.input.onFullscreen = () => this.fullscreen(); this.input.onMute = () => this.toggleMute();
    window.addEventListener('resize', () => this.view.resize());
    window.addEventListener('blur', () => { if (this.screen === 'match' && !this.paused) this.togglePause(true); });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.screen === 'match' && !this.paused) this.togglePause(true);
      this.last = 0; this.accumulator = 0;
    });
    this.view.renderer.domElement.addEventListener('webglcontextlost', e => {
      e.preventDefault(); cancelAnimationFrame(this.animationFrame); this.input.active = false;
      this.ui.innerHTML = '<div class="fatal"><div><h2>The graphics connection was interrupted.</h2><p>Reload the game to reconnect. If it happens again, choose Performance graphics in the match setup.</p><button class="primary-btn" id="reload">Reload game</button></div></div>';
      this.bind('reload', () => location.reload());
    });
    this.home(); this.animationFrame = requestAnimationFrame(t => this.frame(t));
    // Debug controls exist only when explicitly requested; production users never expose internals.
    if (new URLSearchParams(location.search).get('arenaTest') === '1') (window as unknown as { __arena: ArenaApp }).__arena = this;
  }
  private options(): MatchOptions { return { fighters: [...this.picks], stage: this.stage, mode: this.mode, difficulty: this.settings.difficulty, items: this.settings.items }; }
  private save() { try { localStorage.setItem('svs-arena-v1', JSON.stringify(this.settings)); } catch { /* Optional persistence. */ } }
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
    this.screen = 'home'; this.paused = false; this.modalReturn = null; this.input.active = false; this.input.clear(); this.accumulator = 0;
    this.sim = new ArenaSim({ ...this.options(), fighters: [0, 1], stage: 0 });
    this.sim.fighters[0].x = this.sim.fighters[0].prevX = 1.2; this.sim.fighters[1].x = this.sim.fighters[1].prevX = 5.2;
    this.view.setMatch([0, 1], 0);
    this.ui.innerHTML = `<div class="screen hero"><header class="topbar">${brand}<div class="topbar-right"><span class="caps muted"><i class="status-dot"></i>OFFLINE / LOCAL MULTIPLAYER</span>${button('mute', this.settings.muted ? 'SOUND OFF' : 'SOUND ON')}</div></header>
      <main class="hero-copy"><div class="eyebrow">BAY AREA EGOS. ARCADE RULES.</div><h1>Big ideas.<br>Bigger<br><em>knockback.</em></h1><p class="hero-description">Take your rivalry to the rooftop.<br>Six disruptors. Three arenas. One last stock.</p><div class="hero-actions">${button('enter', 'ENTER THE ARENA', true)}${button('how', 'HOW TO PLAY')}</div><div class="hero-features">3D PLATFORM FIGHTING &nbsp; / &nbsp; 1–2 PLAYERS</div></main>
      <div class="location-tag"><span class="caps">01 / MOUNTAIN VIEW, CALIFORNIA</span><strong>Castro Street</strong><span class="caps">THE COFFEE IS $9. THE BEEF IS FREE.</span></div><footer class="bottom-strip"><b>MOVE FAST. BREAK FRIENDSHIPS.</b><span>KEYBOARD + CONTROLLER</span><span class="edition">ARENA EDITION / 01</span></footer></div>`;
    this.bind('enter', () => { this.audio.unlock(); this.selection(); }); this.bind('how', () => this.controls(() => this.home())); this.bind('mute', () => this.toggleMute());
  }
  selection() {
    this.screen = 'select'; this.paused = false; this.modalReturn = null; this.input.active = false; this.input.clear();
    const selected = ROSTER[this.picks[this.activeSlot]], opponentLabel = this.mode === 'versus' ? 'PLAYER 2' : this.mode === 'training' ? 'DUMMY' : 'CPU';
    this.ui.innerHTML = `<div class="screen select-screen"><header class="topbar">${brand}<div class="topbar-right"><span class="caps muted">BUILD YOUR MATCH</span>${button('back', '← BACK')}</div></header>
      <main class="select-layout"><section><h2 class="select-heading">Choose your disruptor.</h2><div class="caps muted">ORIGINAL ROSTER / SIX VERY DIFFERENT EGOS</div>
      <div class="selection-tabs"><button class="selection-tab ${this.activeSlot === 0 ? 'active' : ''}" id="slot0">PLAYER 1<strong>${ROSTER[this.picks[0]].name}</strong></button><button class="selection-tab p2 ${this.activeSlot === 1 ? 'active' : ''}" id="slot1" ${this.mode === 'arcade' ? 'disabled' : ''}>${this.mode === 'arcade' ? 'ARCADE LADDER' : opponentLabel}<strong>${this.mode === 'arcade' ? 'Road to Elon' : ROSTER[this.picks[1]].name}</strong></button></div>
      <div class="roster">${ROSTER.map((f, i) => `<button class="fighter-card ${this.picks[this.activeSlot] === i ? 'selected' : ''}" data-fighter="${i}" aria-label="Select ${f.name}" aria-pressed="${this.picks[this.activeSlot] === i}"><img src="${this.portraits[i]}" alt="3D ${f.name}"><div class="fighter-info"><strong>${f.name}</strong><small>${f.profession}</small></div>${this.picks[0] === i ? '<span class="player-chip">P1</span>' : ''}${this.picks[1] === i && this.mode !== 'arcade' ? `<span class="player-chip second" style="${this.picks[0] === i ? 'top:32px' : ''}">${opponentLabel}</span>` : ''}</button>`).join('')}</div>
      <div class="fighter-detail"><p>“${selected.tagline}”</p><span class="special-name">B / ${SPECIAL_NAMES[this.picks[this.activeSlot]]}</span></div></section>
      <aside class="setup-panel"><h3>MATCH SETTINGS</h3><label class="field">MODE<select id="mode"><option value="cpu">Quick match · vs CPU</option><option value="versus">Local versus · 2 players</option><option value="arcade">Arcade · road to Elon</option><option value="training">Training · practice freely</option></select></label>
      <label class="field">CPU DIFFICULTY<select id="difficulty"><option value="0">Intern · relaxed</option><option value="1">Founder · standard</option><option value="2">Board member · hard</option></select></label>
      <div class="field">ARENA<div class="stage-list">${STAGE_NAMES.map((s, i) => `<button class="stage-option ${this.stage === i ? 'selected' : ''}" data-stage="${i}" aria-pressed="${this.stage === i}"><span><strong>${s}</strong><small>${STAGE_TAGS[i]}</small></span><span class="stage-icon">${['☕', '◇', '↟'][i]}</span></button>`).join('')}</div></div>
      <label class="checkbox-row">Coffee + GPU pickups<input id="items" type="checkbox" ${this.settings.items ? 'checked' : ''}></label><label class="checkbox-row">High quality shadows<input id="quality" type="checkbox" ${this.settings.high ? 'checked' : ''}></label><label class="checkbox-row">Original synth soundtrack<input id="music" type="checkbox" ${this.settings.music ? 'checked' : ''}></label>
      <div class="match-summary">${this.mode === 'training' ? 'UNLIMITED STOCKS / NO TIMER' : '3 STOCKS / 5 MINUTES / RING-OUTS'}</div>${button('fight', this.mode === 'arcade' ? 'START THE CLIMB' : 'LET’S SMACKDOWN', true)}</aside></main></div>`;
    (document.getElementById('mode') as HTMLSelectElement).value = this.mode;
    (document.getElementById('difficulty') as HTMLSelectElement).value = String(this.settings.difficulty);
    (document.getElementById('difficulty') as HTMLSelectElement).disabled = this.mode === 'versus' || this.mode === 'training';
    this.bind('back', () => this.home()); this.bind('slot0', () => { this.activeSlot = 0; this.selection(); }); this.bind('slot1', () => { this.activeSlot = 1; this.selection(); });
    for (const card of this.ui.querySelectorAll<HTMLButtonElement>('[data-fighter]')) card.onclick = () => { this.picks[this.activeSlot] = Number(card.dataset.fighter); this.selection(); };
    for (const card of this.ui.querySelectorAll<HTMLButtonElement>('[data-stage]')) card.onclick = () => { this.stage = Number(card.dataset.stage); this.selection(); };
    document.getElementById('mode')!.onchange = e => { this.mode = (e.target as HTMLSelectElement).value as Mode; if (this.mode === 'arcade') this.activeSlot = 0; this.selection(); };
    document.getElementById('difficulty')!.onchange = e => { this.settings.difficulty = Number((e.target as HTMLSelectElement).value); this.save(); };
    document.getElementById('items')!.onchange = e => { this.settings.items = (e.target as HTMLInputElement).checked; this.save(); };
    document.getElementById('quality')!.onchange = e => { this.settings.high = (e.target as HTMLInputElement).checked; this.view.setQuality(this.settings.high); this.save(); };
    document.getElementById('music')!.onchange = e => { this.settings.music = (e.target as HTMLInputElement).checked; this.audio.music = this.settings.music; this.save(); };
    this.bind('fight', () => { this.audio.unlock(); if (this.mode === 'arcade') { this.ladder = [0, 1, 2, 3, 4].filter(c => c !== this.picks[0]).concat(5); this.ladderIndex = 0; this.picks[1] = this.ladder[0]; } this.launch(); });
  }
  launch(options?: Partial<MatchOptions>) {
    if (options?.fighters) this.picks = [...options.fighters]; if (options?.stage !== undefined) this.stage = options.stage; if (options?.mode) this.mode = options.mode;
    this.sim = new ArenaSim({ ...this.options(), ...options }); this.view.setMatch(this.picks, this.stage);
    this.screen = 'match'; this.paused = false; this.modalReturn = null; this.input.clear(); this.input.active = true;
    this.accumulator = 0; this.last = 0; this.visualTime = 0; this.goTime = 0; this.resultDelay = 0;
    this.renderHud();
  }
  private renderHud() {
    this.ui.innerHTML = `<div class="hud"><div class="hud-top">${brand}<div class="hud-actions">${this.mode === 'training' ? button('reset', 'RESET') : ''}${button('hud-mute', this.settings.muted ? 'SOUND OFF' : 'SOUND ON')}${button('pause', 'PAUSE / ESC')}</div></div>
      <div class="clock"><strong id="timer">5:00</strong><small>${this.mode === 'arcade' ? `ARCADE ${this.ladderIndex + 1}/${this.ladder.length} · ` : ''}${STAGE_NAMES[this.stage].toUpperCase()}</small></div>
      ${this.sim.fighters.map((f, i) => `<div class="player-hud ${i ? 'p2' : ''}"><img class="hud-portrait" src="${this.portraits[f.character]}" alt=""><div class="hud-info"><div class="hud-name"><span class="slot-label">${i ? this.mode === 'versus' ? 'P2' : this.mode === 'training' ? 'DUMMY' : 'CPU' : 'P1'}</span>${ROSTER[f.character].name.toUpperCase()}</div><div class="percent" id="damage${i}">0<small>%</small></div><div class="stocks" id="stocks${i}"></div><div class="shield-track"><i id="shield${i}" style="width:100%"></i></div><div class="badge-buff" id="buff${i}"></div></div></div><div class="floating-marker ${i ? 'p2' : ''}" id="marker${i}">${i ? this.mode === 'versus' ? 'P2' : this.mode === 'training' ? 'DUMMY' : 'CPU' : 'P1'}</div>`).join('')}
      <div class="hud-keys"><div><kbd>WASD</kbd> MOVE &nbsp; <kbd>V</kbd> ATTACK &nbsp; <kbd>B</kbd> SPECIAL</div><div><kbd>N</kbd> SHIELD &nbsp; <kbd>M</kbd> GRAB &nbsp; <kbd>W+B</kbd> RECOVER</div><div class="tiny">${this.mode === 'versus' ? 'P2: ARROWS + J / K / L / ;' : 'MORE DAMAGE = BIGGER KNOCKBACK'}</div></div><div class="center-message" id="center"></div><div class="match-toast" id="toast" style="opacity:0"></div></div>`;
    this.hud = [0, 1].map(i => ({ damage: document.getElementById(`damage${i}`)!, stocks: document.getElementById(`stocks${i}`)!, shield: document.getElementById(`shield${i}`)!, marker: document.getElementById(`marker${i}`)!, buff: document.getElementById(`buff${i}`)! }));
    this.timer = document.getElementById('timer'); this.center = document.getElementById('center'); this.toast = document.getElementById('toast');
    this.bind('pause', () => this.togglePause()); this.bind('hud-mute', () => this.toggleMute()); this.bind('reset', () => this.launch());
  }
  private updateHud(dt: number) {
    if (!this.timer || !this.center) return;
    this.timer.textContent = this.mode === 'training' ? '∞' : formatTime(this.sim.remaining);
    for (let i = 0; i < 2; i++) {
      const f = this.sim.fighters[i], hud = this.hud[i];
      const html = `${Math.floor(f.damage)}<small>%</small>`; if (hud.damage.innerHTML !== html) hud.damage.innerHTML = html;
      hud.damage.style.color = f.damage >= 140 ? '#ff7666' : f.damage >= 80 ? '#ffc181' : '#f4f4db';
      const stocks = this.mode === 'training' ? '<span class="caps muted">PRACTICE</span>' : [0, 1, 2].map(s => `<i class="stock ${s >= f.stocks ? 'lost' : ''}"></i>`).join('');
      if (hud.stocks.innerHTML !== stocks) hud.stocks.innerHTML = stocks;
      hud.shield.style.width = `${f.shield}%`; hud.buff.textContent = f.buff ? `GPU OVERCLOCK / ${Math.ceil(f.buff / 60)}s` : f.respawn ? 'RESPAWNING…' : '';
      const point = this.view.project(f.x, f.y + 2.9);
      hud.marker.style.left = `${Math.max(22, Math.min(window.innerWidth - 22, point.x))}px`; hud.marker.style.top = `${Math.max(95, Math.min(window.innerHeight - 145, point.y))}px`;
      hud.marker.style.display = f.respawn || f.stocks <= 0 ? 'none' : 'block';
    }
    if (this.sim.countdown > 0) this.center.innerHTML = `${Math.ceil(this.sim.countdown / 60)}<small>${this.sim.suddenDeath ? 'SUDDEN DEATH / 150%' : 'GET READY TO DISRUPT'}</small>`;
    else if (this.goTime > 0) { this.center.innerHTML = 'SMACKDOWN!'; this.goTime -= dt; }
    else this.center.innerHTML = '';
    this.toastTime -= dt; if (this.toast) this.toast.style.opacity = this.toastTime > 0 ? '1' : '0';
  }
  private showToast(message: string) { if (this.toast && this.toast.isConnected) { this.toast.textContent = message; this.toastTime = 2; } }
  private togglePause(force?: boolean) {
    if (this.screen !== 'match' || this.sim.finished) return;
    this.paused = force ?? !this.paused; this.input.clear(); this.accumulator = 0;
    if (!this.paused) { this.ui.querySelector('.overlay')?.remove(); this.input.active = true; this.audio.unlock(); return; }
    this.input.active = false; this.pauseMenu();
  }
  private pauseMenu() {
    this.ui.querySelector('.overlay')?.remove();
    const overlay = document.createElement('div'); overlay.className = 'overlay';
    overlay.innerHTML = `<section class="modal"><div class="caps">QUICK COFFEE BREAK</div><h2>Let’s circle back.</h2><p>The match is paused. Your runway can wait.</p><div class="modal-actions">${button('resume', 'BACK TO THE FIGHT', true)}${button('retry', 'RESTART MATCH')}${button('help', 'CONTROLS')}${button('quit', 'CHARACTER SELECT')}</div><div class="modal-actions">${button('pause-mute', this.settings.muted ? 'SOUND OFF' : 'SOUND ON')}${button('fullscreen', 'FULLSCREEN')}${this.mode === 'training' ? button('dummy-damage', 'DUMMY +50%') : ''}</div></section>`;
    this.ui.append(overlay); this.bind('resume', () => this.togglePause(false)); this.bind('retry', () => this.launch()); this.bind('quit', () => this.selection());
    this.bind('help', () => this.controls(() => this.pauseMenu())); this.bind('pause-mute', () => this.toggleMute()); this.bind('fullscreen', () => this.fullscreen());
    this.bind('dummy-damage', () => { this.sim.fighters[1].damage = Math.min(999, this.sim.fighters[1].damage + 50); this.updateHud(0); });
    document.getElementById('resume')?.focus();
  }
  private controls(back: () => void) {
    this.ui.querySelector('.overlay')?.remove(); this.modalReturn = back;
    const overlay = document.createElement('div'); overlay.className = 'overlay';
    overlay.innerHTML = `<section class="modal"><div class="caps">YOUR QUICK START</div><h2>Send them out of office.</h2><p>Build your opponent’s damage, then launch them past the edge. Higher percentages fly farther. Last fighter with stocks wins.</p><table class="control-table"><thead><tr><th>ACTION</th><th>PLAYER 1</th><th>PLAYER 2</th><th>CONTROLLER*</th></tr></thead><tbody>
      <tr><td>Move</td><td>A / D</td><td>← / →</td><td>Left stick / D-pad</td></tr><tr><td>Jump / double jump</td><td>W or Space</td><td>↑</td><td>A / D-pad up</td></tr><tr><td>Attack / air attack</td><td>V</td><td>J (or 4)</td><td>X</td></tr><tr><td>Strong directional attack</td><td>Direction + V</td><td>Direction + J</td><td>Direction + X</td></tr><tr><td>Signature projectile</td><td>B</td><td>K (or 5)</td><td>B</td></tr><tr><td>Rising recovery</td><td>Hold W + tap B</td><td>Hold ↑ + tap K</td><td>Stick up + B</td></tr><tr><td>Down attack / fast fall</td><td>S + B / hold S</td><td>↓ + K / hold ↓</td><td>Down + B / hold down</td></tr><tr><td>Shield / dodge roll</td><td>N / N + A or D</td><td>L / L + ← or →</td><td>LT / LT + direction</td></tr><tr><td>Grab (beats shield)</td><td>M</td><td>; (or +)</td><td>Y</td></tr></tbody></table>
      <p class="control-note">Jump twice, then use <b>up + special</b> to return to the stage. Recovery resets when you land. Hold down to drop through upper platforms. Coffee removes 22% damage; a GPU boosts attacks for 8 seconds. Holding shield too long breaks it. Esc pauses, F enters fullscreen, O mutes.</p><p class="control-note">*Standard Xbox-style button names. Connect a controller and press a button to activate it; the first two detected controllers control P1 and P2. Keyboard works at the same time. Training leaves P2 still; P2 keys can move the dummy.</p><div class="modal-actions">${button('close-controls', 'GOT IT', true)}</div></section>`;
    this.ui.append(overlay); this.bind('close-controls', () => { this.modalReturn = null; overlay.remove(); back(); }); document.getElementById('close-controls')?.focus();
  }
  private results() {
    this.screen = 'result'; this.input.active = false; this.input.clear();
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
  private frame(now: number) {
    this.animationFrame = requestAnimationFrame(t => this.frame(t));
    const dt = this.last ? Math.min(0.08, (now - this.last) / 1000) : 0; this.last = now;
    if (!this.paused) this.visualTime += dt;
    const playing = this.screen === 'match' && !this.paused;
    if (playing && !this.sim.finished) {
      this.accumulator += dt;
      let steps = 0;
      while (this.accumulator >= 1 / 60 && steps++ < 5) {
        const commands = this.input.sample(); if (this.paused) { this.accumulator = 0; break; }
        const before = this.sim.countdown; this.sim.step(commands);
        if (before > 0 && !this.sim.countdown) this.goTime = 0.65;
        for (const event of this.sim.events) {
          this.view.event(event); this.audio.effect(event.type);
          if (event.type === 'pickup') this.showToast(event.text ?? 'PICKUP');
          if (event.type === 'break') this.showToast('SHIELD BROKEN!');
          if (event.type === 'ledge') this.showToast('BACK IN BUSINESS / LEDGE RECOVERY');
          if (event.type === 'ko') this.showToast(`${ROSTER[this.sim.fighters[event.slot].character].name.toUpperCase()} / OUT OF OFFICE`);
          if (event.type === 'hit') {
            const point = this.view.project(event.x, event.y + 0.9), popup = document.createElement('div'); popup.className = 'damage-pop'; popup.textContent = `+${Math.round(event.value ?? 0)}`;
            popup.style.left = `${point.x}px`; popup.style.top = `${point.y}px`; this.ui.append(popup); setTimeout(() => popup.remove(), 700);
          }
        }
        this.sim.events.length = 0; this.accumulator -= 1 / 60;
      }
      if (steps >= 5) this.accumulator = Math.min(this.accumulator, 1 / 60);
    }
    if (playing && this.sim.finished) { this.resultDelay += dt; if (this.resultDelay > 1) this.results(); }
    const menu = this.screen === 'home' || this.screen === 'select';
    this.view.render(this.sim, dt, this.visualTime, menu, this.paused || menu || this.sim.finished ? 1 : Math.max(0, Math.min(1, this.accumulator * 60)), this.paused);
    if (this.screen === 'match' || this.screen === 'result') this.updateHud(this.paused ? 0 : dt);
    this.audio.update(playing && !this.sim.finished);
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
