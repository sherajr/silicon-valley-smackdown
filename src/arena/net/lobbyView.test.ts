import { describe, expect, it } from 'vitest';
import { inviteUrl, relayUrl, roomFromLocation } from './lobbyView';

describe('online addresses', () => {
  it('builds a same-origin socket from the page path', () => {
    expect(relayUrl({ protocol: 'http:', host: '127.0.0.1:5173', pathname: '/' }, { BASE_URL: './' })).toBe('ws://127.0.0.1:5173/ws');
    expect(relayUrl({ protocol: 'https:', host: 'play.example', pathname: '/arena/index.html' }, { BASE_URL: './' })).toBe('wss://play.example/arena/ws');
    expect(relayUrl({ protocol: 'http:', host: 'localhost:5173', pathname: '/' }, { BASE_URL: '/silicon-valley-smackdown/', VITE_MULTIPLAYER_URL: '' })).toBe('ws://localhost:5173/silicon-valley-smackdown/ws');
    expect(relayUrl({ protocol: 'http:', host: 'localhost', pathname: '/' }, { VITE_MULTIPLAYER_URL: 'wss://relay.example/ws' })).toBe('wss://relay.example/ws');
  });

  it('keeps the path and only the room code', () => {
    expect(inviteUrl('ABCDEFGH', 'http://127.0.0.1:5173/play/index.html?classic=1&arenaTest=1#top')).toBe('http://127.0.0.1:5173/play/index.html?room=ABCDEFGH');
    expect(roomFromLocation('?room=abcd-efgh')).toBe('ABCDEFGH');
    expect(roomFromLocation('?room=ABCD-EF2O')).toBeNull();
  });
});
