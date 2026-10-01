/**
 * Online lobby markup and address helpers. Kept out of App so the match coordinator
 * does not own URL rules. Invite links keep the current path and carry only the room code.
 */
import { formatCode, normalizeCode } from '../../../shared/onlineProtocol';
import type { RoomView } from '../../../shared/onlineProtocol';

export interface OnlineEnv {
  VITE_PORTABLE?: string;
  VITE_MULTIPLAYER_URL?: string;
  VITE_PUBLIC_GAME_URL?: string;
  BASE_URL?: string;
}

export function onlineEnabled(env: OnlineEnv = import.meta.env): boolean {
  return env.VITE_PORTABLE !== '1';
}

/** Shown on the portable build when a hosted game URL was provided at build time. */
export function publicGameUrl(env: OnlineEnv = import.meta.env): string | null {
  const url = env.VITE_PUBLIC_GAME_URL;
  if (!url || !/^https?:\/\//.test(url)) return null;
  return url;
}

export function relayUrl(
  loc: { protocol: string; host: string; pathname: string } = location,
  env: OnlineEnv = import.meta.env,
): string {
  if (env.VITE_MULTIPLAYER_URL) return env.VITE_MULTIPLAYER_URL;
  const proto = loc.protocol === 'https:' ? 'wss:' : 'ws:';
  let prefix = env.BASE_URL || '/';
  if (prefix.startsWith('./')) prefix = loc.pathname.replace(/[^/]*$/, '') + prefix.slice(2);
  if (!prefix.startsWith('/')) prefix = `/${prefix}`;
  if (!prefix.endsWith('/')) prefix += '/';
  return `${proto}//${loc.host}${prefix}ws`;
}

export function inviteUrl(code: string, href = location.href): string {
  const url = new URL(href);
  url.hash = '';
  url.search = '';
  url.searchParams.set('room', code);
  return url.toString();
}

export function roomFromLocation(search = location.search): string | null {
  const raw = new URLSearchParams(search).get('room');
  return raw ? normalizeCode(raw) : null;
}

const button = (id: string, label: string, primary = false) =>
  `<button id="${id}" class="${primary ? 'primary-btn' : 'ghost-btn'}">${label}${primary ? '<span class="arrow">↗</span>' : ''}</button>`;

export function onlineGateMarkup(brand: string, prefill: string, status: string, soundLabel: string): string {
  return `<div class="screen select-screen"><header class="topbar">${brand}<div class="topbar-right"><span class="caps muted"><i class="status-dot"></i>ONLINE / INVITE CODE</span>${button('mute', soundLabel)}${button('back', '← BACK')}</div></header>
    <main class="select-layout"><section><h2 class="select-heading">Private room. No accounts.</h2><p class="hero-description">Create a code and send it, or join one a friend already has. The code invites someone into the open seat. It is not a password for your session.</p>
      <label class="field">ROOM CODE<input id="join-code" maxlength="11" autocomplete="off" spellcheck="false" value="${prefill}" placeholder="ABCD-EFGH"></label>
      <div class="hero-actions">${button('join-room', 'JOIN WITH CODE', true)}${button('create-room', 'CREATE A ROOM')}</div>
      <p class="online-status" id="online-status">${status}</p></section>
      <aside class="setup-panel"><h3>HOW A ROOM WORKS</h3><p class="control-note">The host picks the arena and whether items are on. Each player picks their own fighter. Both press ready, then both load the same seeded match. A dropped connection stops the round with no winner. Forfeit gives the round to the other player. Leave ends your seat and does not award that win.</p></aside></main></div>`;
}

export interface LobbyMarkup {
  brand: string;
  view: RoomView;
  names: string[];
  portraits: string[];
  accents: string[];
  roles: string[];
  professions: string[];
  stageNames: string[];
  stageTags: string[];
  invite: string;
  status: string;
  soundLabel: string;
  qualityOptions: string;
  quality: string;
  reduced: boolean;
  shake: boolean;
  music: boolean;
}

export function lobbyMarkup(opts: LobbyMarkup): string {
  const view = opts.view;
  const you = view.slot;
  const them = (1 - you) as 0 | 1;
  const code = formatCode(view.code);
  const host = you === 0;
  const opponent = view.occupied[them] ? opts.names[view.fighters[them]] : 'Waiting for opponent';
  const readyLabel = view.ready[you] ? 'CANCEL READY' : 'READY';
  return `<div class="screen select-screen"><header class="topbar">${opts.brand}<div class="topbar-right"><span class="caps muted"><i class="status-dot"></i>${view.connected[them] ? 'OPPONENT CONNECTED' : 'WAITING FOR OPPONENT'}</span>${button('mute', opts.soundLabel)}${button('leave-room', 'LEAVE ROOM')}</div></header>
    <main class="select-layout"><section><h2 class="select-heading">${host ? 'You are the host.' : 'You joined the room.'}</h2>
      <label class="field">ROOM CODE<input id="room-code" readonly value="${code}"></label>
      <div class="hero-actions">${button('copy-code', 'COPY CODE')}${button('copy-link', 'COPY INVITE LINK')}</div>
      <label class="field">INVITE LINK<input id="invite-link" readonly value="${escapeAttr(opts.invite)}"></label>
      <div class="selection-tabs"><button class="selection-tab active" type="button">YOU<strong>${opts.names[view.fighters[you]]}</strong></button><button class="selection-tab p2" type="button" disabled>${view.occupied[them] ? 'OPPONENT' : 'OPEN SEAT'}<strong>${opponent}</strong></button></div>
      <div class="roster">${opts.names.map((name, i) => `<button class="fighter-card ${view.fighters[you] === i ? 'selected' : ''}" style="--accent:${opts.accents[i]}" data-fighter="${i}" aria-label="Select ${name}" aria-pressed="${view.fighters[you] === i}"><img src="${opts.portraits[i]}" alt=""><span class="role">${opts.roles[i]}</span><div class="fighter-info"><strong>${name}</strong><small>${opts.professions[i]}</small></div></button>`).join('')}</div>
      <p class="online-status" id="online-status">${opts.status}</p></section>
      <aside class="setup-panel"><h3>MATCH SETTINGS</h3>
      <div class="field">ARENA<div class="stage-list">${opts.stageNames.map((name, i) => `<button class="stage-option ${view.stage === i ? 'selected' : ''}" data-stage="${i}" ${host ? '' : 'disabled'} aria-pressed="${view.stage === i}"><span><strong>${name}</strong><small>${opts.stageTags[i]}</small></span></button>`).join('')}</div></div>
      <label class="checkbox-row">Coffee + GPU pickups<input id="items" type="checkbox" ${view.items ? 'checked' : ''} ${host ? '' : 'disabled'}></label>
      <p class="control-note">${host ? 'You choose the arena and items. Your opponent’s ready status clears when you change them.' : 'The host chooses the arena and items.'}</p>
      <label class="field">GRAPHICS<select id="quality">${opts.qualityOptions}</select></label>
      <label class="checkbox-row">Reduced motion<input id="reduced" type="checkbox" ${opts.reduced ? 'checked' : ''}></label>
      <label class="checkbox-row">Camera shake<input id="shake" type="checkbox" ${opts.shake ? 'checked' : ''}></label>
      <label class="checkbox-row">Original synth soundtrack<input id="music" type="checkbox" ${opts.music ? 'checked' : ''}></label>
      <div class="match-summary">${view.ready[0] ? 'YOU READY' : 'YOU NOT READY'} / ${view.occupied[them] ? (view.ready[them] ? 'OPPONENT READY' : 'OPPONENT NOT READY') : 'SEAT OPEN'}</div>
      ${button('ready', readyLabel, true)}</aside></main></div>`;
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
