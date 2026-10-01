import { describe, expect, it } from 'vitest';
import { ArenaSim } from '../Simulation';
import type { Controls } from '../controls';
import { ctl, faceOff } from '../testHelpers';
import { RollbackSession, predictControls } from './RollbackSession';
import type { WireInput } from '../../../shared/onlineProtocol';

const script = (frame: number, slot: number): Controls => {
  if (slot === 0 && frame === 18) return ctl({ attack: true });
  if (slot === 0 && frame === 46) return ctl({ grab: true });
  if (slot === 0 && frame === 52) return ctl({ grab: true, x: 1 });
  if (slot === 1 && frame >= 14 && frame <= 30) return ctl({ shield: true, x: frame > 24 ? -1 : 0 });
  if (slot === 1 && frame === 40) return ctl({ jump: true });
  if (frame >= 60 && frame % 17 === slot) return ctl({ special: true, x: slot === 0 ? 1 : -1 });
  return ctl({ x: frame > 6 ? (slot === 0 ? 1 : -1) : 0 });
};

function fresh(seed = 11) {
  const options = { fighters: [0, 0] as [number, number], stage: 0, mode: 'versus' as const, difficulty: 1, items: true, seed };
  const make = () => {
    const sim = new ArenaSim({ ...options, fighters: [...options.fighters] });
    sim.countdown = 0;
    faceOff(sim, 1.05);
    return sim;
  };
  return { options, make };
}

function offline(frames: number, seed = 11) {
  const { make } = fresh(seed);
  const sim = make();
  const events: string[] = [];
  for (let frame = 0; frame < frames; frame++) {
    sim.step([script(frame, 0), script(frame, 1)]);
    for (const event of sim.events) events.push(`${sim.tick}:${event.type}:${event.slot}`);
    sim.events.length = 0;
  }
  return { sim, events };
}

function take(from: RollbackSession, to: RollbackSession, at: number, queue: { at: number; to: RollbackSession; frame: number; input: WireInput }[]) {
  for (const packet of from.takeOutbound()) {
    from.ackLocal(packet.frame, packet.input);
    queue.push({ at, to, frame: packet.frame, input: packet.input });
  }
}

describe('rollback session', () => {
  it('does not repeat action pulses while predicting held directions and shield', () => {
    expect(predictControls(ctl({ x: -1, up: true, shield: true, attack: true, jump: true }))).toEqual(ctl({ x: -1, up: true, shield: true }));
    expect(predictControls(undefined)).toEqual(ctl());
    const { make } = fresh();
    let now = 0;
    const local = new RollbackSession({ sim: make(), localSlot: 0, matchId: 'm', epoch: 1, now: () => now });
    const hold = ctl({ x: 1, shield: true, attack: true });
    for (let i = 0; i < 6; i++) {
      expect(local.wantsLocal()).toBe(true);
      local.submitLocal(i === 0 ? hold : ctl({ x: 1, shield: true }));
    }
    for (const packet of local.takeOutbound()) {
      local.ackLocal(packet.frame, packet.input);
      if (packet.frame < 4) local.pushRemote(packet.frame, packet.input.a ? { ...packet.input, a: true, x: 1, h: true } : { x: 1, u: false, d: false, j: false, a: packet.frame === 3, s: false, h: true, g: false });
    }
    let guard = 0;
    while (local.stepOne() === 'stepped' && guard++ < 30) { /* catch up to the prediction limit */ }
    expect(local.waiting).toBe(true);
    expect(local.appliedRemote(3)?.attack).toBe(true);
    expect(local.appliedRemote(4)?.attack).toBe(false);
    expect(local.appliedRemote(4)?.jump).toBe(false);
    expect(local.appliedRemote(5)?.shield).toBe(true);
    expect(local.appliedRemote(5)?.x).toBe(1);
  });

  it('matches an offline replay after delayed inputs force a rollback through a hit and a grab', () => {
    const frames = 90;
    const truth = offline(frames);
    const { make } = fresh();
    let now = 0;
    const a = new RollbackSession({ sim: make(), localSlot: 0, matchId: 'm', epoch: 1, now: () => now });
    const b = new RollbackSession({ sim: make(), localSlot: 1, matchId: 'm', epoch: 1, now: () => now });
    const delay = 6;
    const queue: { at: number; to: RollbackSession; frame: number; input: WireInput }[] = [];
    const seen = [new Set<string>(), new Set<string>()];
    const hits: string[] = [];
    let stepped = 0;
    for (let clock = 0; clock < frames + delay + 5; clock++) {
      now = clock * 16;
      for (const [session, slot] of [[a, 0], [b, 1]] as const) {
        if (session.wantsLocal()) session.submitLocal(script(session.nextLocalFrame, slot));
        const status = session.stepOne();
        if (status === 'stepped') stepped++;
        for (const event of session.drainEvents()) {
          expect(seen[slot].has(event.id)).toBe(false);
          seen[slot].add(event.id);
          if (slot === 0 && event.tick <= frames && (event.event.type === 'hit' || event.event.type === 'catch' || event.event.type === 'throw')) hits.push(`${event.tick}:${event.event.type}`);
        }
      }
      take(a, b, clock + delay, queue);
      take(b, a, clock + delay, queue);
      for (const item of queue) if (item.at === clock) item.to.pushRemote(item.frame, item.input);
    }
    expect(stepped).toBeGreaterThan(frames);
    expect(a.interrupted).toBeNull();
    expect(b.interrupted).toBeNull();
    expect(a.hashAt(frames)).toBe(truth.sim.hashState());
    expect(b.hashAt(frames)).toBe(truth.sim.hashState());
    expect(a.confirmedResult()).toBeNull();
    const kind = (entry: string) => entry.split(':')[1];
    for (const type of ['hit', 'catch']) {
      expect(hits.filter(entry => kind(entry) === type).length).toBe(truth.events.filter(entry => kind(entry) === type).length);
    }
  });

  it('sends a checksum for each shared frame on the schedule exactly once, and both clients pick the same frames', () => {
    const { make } = fresh(6);
    const a = new RollbackSession({ sim: make(), localSlot: 0, matchId: 'm', epoch: 1, stallMs: 60_000, now: () => 0 });
    const b = new RollbackSession({ sim: make(), localSlot: 1, matchId: 'm', epoch: 1, stallMs: 60_000, now: () => 0 });
    const sent: Record<'a' | 'b', { frame: number; hash: string }[]> = { a: [], b: [] };
    const pending: { at: number; session: RollbackSession; frame: number; input: WireInput }[] = [];
    let time = 0;
    const pump = (session: RollbackSession, slot: number, name: 'a' | 'b', latency: number) => {
      if (session.wantsLocal()) session.submitLocal(script(session.nextLocalFrame, slot));
      session.stepOne();
      const other = session === a ? b : a;
      for (const packet of session.takeOutbound()) {
        session.ackLocal(packet.frame, packet.input);
        pending.push({ at: time + latency, session: other, frame: packet.frame, input: packet.input });
      }
      const hash = session.takeHash(); if (hash) sent[name].push(hash);
    };
    for (; time < 3000; time += 4) {
      if (time % 16 === 0) pump(a, 0, 'a', 30);
      if (time % 20 === 0) pump(b, 1, 'b', 45);
      for (const item of pending) if (item.at <= time) item.session.pushRemote(item.frame, item.input);
    }
    expect(a.interrupted).toBeNull(); expect(b.interrupted).toBeNull();
    expect(a.confirmed).toBeGreaterThan(120);
    for (const list of [sent.a, sent.b]) {
      const frames = list.map(h => h.frame);
      expect(frames.every(f => f % a.hashInterval === 0)).toBe(true);
      expect(new Set(frames).size).toBe(frames.length);                     // never the same frame twice
      expect(frames).toEqual([...frames].sort((x, y) => x - y));
    }
    // Both sides checksum the same frames, so every one can be compared, and they agree.
    const theirs = new Map(sent.b.map(h => [h.frame, h.hash]));
    const shared = sent.a.filter(h => theirs.has(h.frame));
    expect(shared.length).toBeGreaterThan(3);
    for (const h of shared) expect(theirs.get(h.frame)).toBe(h.hash);
    // Far fewer than one checksum per frame: the old schedule sent one per confirmed advance, about 60 a second.
    expect(sent.a.length).toBeLessThanOrEqual(Math.floor(a.confirmed / a.hashInterval) + 1);
  });

  it('converges when the two clients advance on different schedules', () => {
    const frames = 70;
    const truth = offline(frames, 4);
    const { make } = fresh(4);
    const a = new RollbackSession({ sim: make(), localSlot: 0, matchId: 'm', epoch: 2, stallMs: 60_000, now: () => 0 });
    const b = new RollbackSession({ sim: make(), localSlot: 1, matchId: 'm', epoch: 2, stallMs: 60_000, now: () => 0 });
    const pending: { at: number; session: RollbackSession; frame: number; input: WireInput }[] = [];
    let time = 0;
    const nextA = () => 16, nextB = () => 21;
    let dueA = 0, dueB = 7;
    const pump = (session: RollbackSession, slot: number, latency: number) => {
      if (session.wantsLocal()) session.submitLocal(script(session.nextLocalFrame, slot));
      session.stepOne();
      const other = session === a ? b : a;
      for (const packet of session.takeOutbound()) {
        session.ackLocal(packet.frame, packet.input);
        pending.push({ at: time + latency, session: other, frame: packet.frame, input: packet.input });
      }
    };
    while (time < 4000 && (a.sim.tick < frames || b.sim.tick < frames || a.confirmed < frames || b.confirmed < frames)) {
      if (time >= dueA) { pump(a, 0, 25); dueA += nextA(); }
      if (time >= dueB) { pump(b, 1, 40); dueB += nextB(); }
      for (const item of pending) if (item.at <= time) item.session.pushRemote(item.frame, item.input);
      time += 5;
    }
    expect(a.interrupted).toBeNull();
    expect(b.interrupted).toBeNull();
    expect(a.hashAt(frames)).toBe(truth.sim.hashState());
    expect(b.hashAt(frames)).toBe(a.hashAt(frames));
    expect(a.snapshotCount).toBeLessThanOrEqual(a['history'] + 2);
  });

  it('rejects conflicts, confirmation gaps, stale hashes and prediction exhaustion', () => {
    const { make } = fresh();
    let now = 0;
    const session = new RollbackSession({ sim: make(), localSlot: 0, matchId: 'm', epoch: 1, history: 40, stallMs: 500, now: () => now });
    const ackOutbound = () => {
      for (const packet of session.takeOutbound()) session.ackLocal(packet.frame, packet.input);
    };
    const feed = (n: number) => {
      ackOutbound();
      for (let i = 0; i < n; i++) if (session.wantsLocal()) session.submitLocal(ctl({ x: 1 }));
      ackOutbound();
    };
    feed(8);
    session.pushRemote(3, { x: 1, u: false, d: false, j: false, a: false, s: false, h: false, g: false });
    expect(session.confirmed).toBe(0);
    for (let frame = 0; frame < 3; frame++) session.pushRemote(frame, { x: 0, u: false, d: false, j: false, a: false, s: false, h: false, g: false });
    expect(session.confirmed).toBe(4);
    session.pushRemote(1, { x: 0, u: false, d: false, j: false, a: false, s: false, h: false, g: false });
    expect(session.interrupted).toBeNull();
    session.pushRemote(1, { x: -1, u: false, d: false, j: false, a: false, s: false, h: false, g: false });
    expect(session.interrupted).toBe('conflict');

    const other = new RollbackSession({ sim: fresh().make(), localSlot: 0, matchId: 'm', epoch: 1, stallMs: 200, now: () => now });
    const ackOther = () => { for (const packet of other.takeOutbound()) other.ackLocal(packet.frame, packet.input); };
    for (let i = 0; i < 20; i++) {
      if (other.wantsLocal()) other.submitLocal(ctl());
      ackOther();
      other.pushRemote(i, { x: 0, u: false, d: false, j: false, a: false, s: false, h: false, g: false });
      other.stepOne();
      now += 20;
    }
    const good = other.hashAt(other.confirmed);
    expect(good).toBeTruthy();
    other.noteRemoteHash(other.confirmed, 'deadbeefdeadbeef');
    expect(other.interrupted).toBe('desync');

    now = 0;
    const waiting = new RollbackSession({ sim: fresh().make(), localSlot: 0, matchId: 'm', epoch: 1, predictionLimit: 4, stallMs: 100, now: () => now });
    for (let i = 0; i < 6; i++) {
      if (waiting.wantsLocal()) {
        const submitted = waiting.submitLocal(ctl({ x: 1 }));
        if (submitted) waiting.ackLocal(submitted.frame, submitted.input);
      }
      waiting.stepOne();
    }
    expect(waiting.waiting).toBe(true);
    const stuck = waiting.sim.tick;
    now += 150;
    expect(waiting.stepOne()).toBe('stop');
    expect(waiting.interrupted).toBe('stall');
    expect(waiting.sim.tick).toBe(stuck);
  });

  it('does not publish a finish until the finishing inputs are confirmed', () => {
    const { make } = fresh();
    const sim = make();
    sim.remaining = 4;
    sim.fighters[1].damage = 40;
    const session = new RollbackSession({ sim, localSlot: 0, matchId: 'm', epoch: 1, now: () => 0 });
    for (let frame = 0; frame < 6; frame++) {
      if (session.wantsLocal()) {
        const submitted = session.submitLocal(ctl());
        if (submitted && submitted.frame < 3) session.ackLocal(submitted.frame, submitted.input);
      }
      session.pushRemote(frame, { x: 0, u: false, d: false, j: false, a: false, s: false, h: false, g: false });
      session.stepOne();
    }
    expect(session.sim.finished).toBe(true);
    expect(session.confirmedResult()).toBeNull();
    for (const packet of session.takeOutbound()) session.ackLocal(packet.frame, packet.input);
    const result = session.confirmedResult();
    expect(result?.winner).toBe(session.sim.winner);
    const drained = session.drainEvents();
    expect(drained.some(event => event.event.type === 'finish')).toBe(true);
    expect(session.drainEvents()).toEqual([]);
  });
});
