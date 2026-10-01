/**
 * Browser socket for one player. The session token stays in memory and is never written
 * into the address bar. Frame numbers, not the start clock, decide which input is which.
 */
import { gameplayFingerprint } from '../../../shared/fingerprint';
import { decodeMessage, encodeMessage, HEARTBEAT_MS, PROTOCOL_VERSION } from '../../../shared/onlineProtocol';
import type { ClientMessage, ServerMessage } from '../../../shared/onlineProtocol';

export class OnlineClient {
  private socket: WebSocket | null = null;
  private generation = 0;
  private token: string | null = null;
  private pingTimer = 0;
  private pingId = 1;
  rtt: number | null = null;
  /** Added to Date.now() to estimate the server clock. */
  offset = 0;
  onMessage: (message: ServerMessage) => void = () => {};
  onClose: () => void = () => {};
  socketFactory: (url: string) => WebSocket = url => new WebSocket(url);

  get session(): string | null { return this.token; }

  connect(url: string, resume = false) {
    const gen = ++this.generation;
    this.closeSocket();
    const ws = this.socketFactory(url);
    this.socket = ws;
    ws.addEventListener('open', () => {
      if (gen !== this.generation) return;
      const hello: ClientMessage = { t: 'hello', protocol: PROTOCOL_VERSION, fingerprint: gameplayFingerprint() };
      if (resume && this.token) this.send({ ...hello, resume: this.token });
      else this.send(hello);
      this.pingTimer = window.setInterval(() => this.ping(), HEARTBEAT_MS);
      this.ping();
    });
    ws.addEventListener('message', event => {
      if (gen !== this.generation) return;
      const message = decodeMessage(String(event.data), 'server');
      if (!message) return;
      if (message.t === 'welcome') this.token = message.session;
      if (message.t === 'pong') {
        const now = Date.now();
        this.rtt = Math.max(0, now - message.clientTime);
        this.offset = message.serverTime - (message.clientTime + this.rtt / 2);
      }
      this.onMessage(message);
    });
    ws.addEventListener('close', () => {
      if (gen !== this.generation) return;
      this.stopPing();
      this.socket = null;
      this.onClose();
    });
  }

  send(message: ClientMessage): boolean {
    const ws = this.socket;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    if (ws.bufferedAmount > 1_000_000) {
      ws.close(1011, 'backpressure');
      return false;
    }
    ws.send(encodeMessage(message));
    return true;
  }

  now(): number { return Date.now() + this.offset; }

  /** Tell the room we are leaving, then drop the socket. */
  leave() {
    const gen = ++this.generation;
    this.send({ t: 'leave' });
    this.token = null;
    this.closeSocket();
    if (gen) this.stopPing();
  }

  /** Drop the socket without a forfeit or a leave, so the server treats it as a disconnect. */
  drop() {
    this.generation++;
    this.closeSocket();
  }

  private ping() {
    this.send({ t: 'ping', id: this.pingId++, clientTime: Date.now() });
  }

  private stopPing() {
    if (this.pingTimer) window.clearInterval(this.pingTimer);
    this.pingTimer = 0;
  }

  private closeSocket() {
    this.stopPing();
    const ws = this.socket;
    this.socket = null;
    if (ws && ws.readyState < WebSocket.CLOSING) ws.close();
  }
}
