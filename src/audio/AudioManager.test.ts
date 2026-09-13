import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioManager } from './AudioManager';

// teardownRecorded() tears down the outgoing <audio> element on a short real setTimeout
// fade (~150-180ms) rather than synchronously, so every test below runs under fake timers
// and flushes with advanceTimersByTimeAsync() before asserting on post-teardown state.
const FLUSH_MS = 300;
async function flush(): Promise<void> {
  await vi.advanceTimersByTimeAsync(FLUSH_MS);
}

// AudioManager talks to real browser APIs (AudioContext, <audio>, URL.createObjectURL).
// The vitest environment here is plain `node`, so we install minimal fakes for exactly
// the surface AudioManager touches -- enough to drive real transport logic (not just a
// mocked-out no-op) without needing a jsdom/browser dependency.

class FakeAudioParam {
  value = 0;
  setValueAtTime(v: number): void {
    this.value = v;
  }
  linearRampToValueAtTime(v: number): void {
    this.value = v;
  }
  exponentialRampToValueAtTime(v: number): void {
    this.value = v;
  }
  cancelScheduledValues(): void {}
}

class FakeNode {
  connect(): void {}
  disconnect(): void {}
}

class FakeGainNode extends FakeNode {
  gain = new FakeAudioParam();
}

class FakeOscillator extends FakeNode {
  type = 'sine';
  frequency = new FakeAudioParam();
  onended: (() => void) | null = null;
  start(): void {}
  stop(): void {}
}

class FakeBufferSource extends FakeNode {
  buffer: unknown = null;
  onended: (() => void) | null = null;
  start(): void {}
  stop(): void {}
}

class FakeBiquadFilter extends FakeNode {
  type = 'lowpass';
  frequency = new FakeAudioParam();
}

export const createdAudioElements: FakeAudioElement[] = [];

class FakeAudioElement {
  src: string;
  loop = false;
  preload = '';
  volume = 1;
  paused = true;
  destroyed = false;
  playCount = 0;
  private listeners: Record<string, (() => void)[]> = {};

  constructor(url: string) {
    this.src = url;
    createdAudioElements.push(this);
  }
  play(): Promise<void> {
    this.paused = false;
    this.playCount++;
    return Promise.resolve();
  }
  pause(): void {
    this.paused = true;
  }
  removeAttribute(): void {
    this.destroyed = true;
  }
  load(): void {}
  addEventListener(evt: string, fn: () => void): void {
    (this.listeners[evt] ??= []).push(fn);
  }
}

class FakeAudioContext {
  currentTime = 0;
  destination = {};
  createGain(): FakeGainNode {
    return new FakeGainNode();
  }
  createOscillator(): FakeOscillator {
    return new FakeOscillator();
  }
  createBufferSource(): FakeBufferSource {
    return new FakeBufferSource();
  }
  createBiquadFilter(): FakeBiquadFilter {
    return new FakeBiquadFilter();
  }
  createBuffer(_channels: number, length: number): { getChannelData: () => Float32Array } {
    const data = new Float32Array(length);
    return { getChannelData: () => data };
  }
  createMediaElementSource(_el: FakeAudioElement): FakeNode {
    return new FakeNode();
  }
  resume(): Promise<void> {
    return Promise.resolve();
  }
}

function installFakeBrowserGlobals(): void {
  (globalThis as unknown as { window: unknown }).window = globalThis;
  (globalThis as unknown as { AudioContext: unknown }).AudioContext = FakeAudioContext;
  (globalThis as unknown as { Audio: unknown }).Audio = FakeAudioElement;
  (globalThis as unknown as { URL: { createObjectURL: unknown; revokeObjectURL: unknown } }).URL.createObjectURL = (
    file: { name: string },
  ) => `blob:${file.name}`;
  (globalThis as unknown as { URL: { createObjectURL: unknown; revokeObjectURL: unknown } }).URL.revokeObjectURL = () => {};
}

function makeFile(name: string): File {
  return new File(['fake-audio-bytes'], name, { type: 'audio/mpeg' });
}

describe('AudioManager custom-track transport', () => {
  let manager: AudioManager;

  beforeEach(() => {
    installFakeBrowserGlobals();
    createdAudioElements.length = 0;
    vi.useFakeTimers();
    manager = new AudioManager();
    manager.init();
  });

  afterEach(() => {
    manager.stopMusic();
    vi.useRealTimers();
  });

  it('starts the recorded backend when a custom file is chosen while the synth loop plays the same scene track', async () => {
    manager.playMusic('castro_street');
    expect(createdAudioElements).toHaveLength(0); // still the synth fallback, no <audio> yet

    manager.setCustomTrackFile(makeFile('trackA.mp3'));
    await flush();

    expect(createdAudioElements).toHaveLength(1);
    expect(createdAudioElements[0].src).toBe('blob:trackA.mp3');
    expect(createdAudioElements[0].playCount).toBe(1);
    expect(manager.getSelectedTrackLabel()).toBe('trackA.mp3');
  });

  it('switches playback backend from file A to file B even though the scene track id never changes', async () => {
    manager.playMusic('castro_street');
    manager.setCustomTrackFile(makeFile('trackA.mp3'));
    await flush();
    const elA = createdAudioElements[0];

    manager.setCustomTrackFile(makeFile('trackB.mp3'));
    await flush();

    expect(createdAudioElements).toHaveLength(2);
    const elB = createdAudioElements[1];
    expect(elB.src).toBe('blob:trackB.mp3');
    expect(elB.playCount).toBe(1);
    // The old element must actually be torn down, not left playing underneath the new one.
    expect(elA.paused).toBe(true);
    expect(elA.destroyed).toBe(true);
    expect(manager.getSelectedTrackLabel()).toBe('trackB.mp3');
  });

  it('returns to the original synthesized score when the custom track is cleared, tearing down the recorded element', async () => {
    manager.playMusic('castro_street');
    manager.setCustomTrackFile(makeFile('trackA.mp3'));
    await flush();
    const elA = createdAudioElements[0];

    manager.clearCustomTrack();
    await flush();

    expect(elA.paused).toBe(true);
    expect(elA.destroyed).toBe(true);
    expect(manager.hasCustomTrack()).toBe(false);
    expect(manager.getSelectedTrackLabel()).toBe('Original Score');
    // No new <audio> element should be created for the synth fallback.
    expect(createdAudioElements).toHaveLength(1);
  });

  it('carries a custom track choice across paused and stopped states without reviving the old element', async () => {
    manager.playMusic('castro_street');
    manager.setCustomTrackFile(makeFile('trackA.mp3'));
    await flush();
    manager.pauseMusic();
    expect(createdAudioElements[0].paused).toBe(true);

    manager.resumeMusic();
    expect(createdAudioElements[0].paused).toBe(false);

    manager.stopMusic();
    await flush();
    expect(createdAudioElements[0].destroyed).toBe(true);

    // Re-entering the scene (playMusic with the same track id) must restart the same
    // chosen file rather than silently falling back to the synth track.
    manager.playMusic('castro_street');
    await flush();
    expect(createdAudioElements).toHaveLength(2);
    expect(createdAudioElements[1].src).toBe('blob:trackA.mp3');
  });

  it('full round trip: original score -> file A -> file B -> original score, scene id constant throughout', async () => {
    manager.playMusic('menu');
    expect(manager.getSelectedTrackLabel()).toBe('Original Score');

    manager.setCustomTrackFile(makeFile('trackA.mp3'));
    await flush();
    expect(manager.getSelectedTrackLabel()).toBe('trackA.mp3');

    manager.setCustomTrackFile(makeFile('trackB.mp3'));
    await flush();
    expect(manager.getSelectedTrackLabel()).toBe('trackB.mp3');
    expect(createdAudioElements[1].playCount).toBe(1);

    manager.clearCustomTrack();
    await flush();
    expect(manager.getSelectedTrackLabel()).toBe('Original Score');
    expect(createdAudioElements.every((el) => el.destroyed)).toBe(true);
  });
});
