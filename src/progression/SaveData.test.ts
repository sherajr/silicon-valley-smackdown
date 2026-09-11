import { afterEach, describe, expect, it } from 'vitest';
import { defaultSaveData, loadSaveData, saveSaveData } from './SaveData';

function installFakeStorage(): Map<string, string> {
  const store = new Map<string, string>();
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => {
      store.set(k, v);
    },
    removeItem: (k: string) => {
      store.delete(k);
    },
    clear: () => store.clear(),
    key: () => null,
    length: 0,
  } as Storage;
  return store;
}

afterEach(() => {
  delete (globalThis as unknown as { localStorage?: Storage }).localStorage;
});

describe('SaveData', () => {
  it('falls back to defaults when storage is unavailable', () => {
    const data = loadSaveData();
    expect(data).toEqual(defaultSaveData());
  });

  it('falls back to defaults when stored content is malformed JSON', () => {
    const store = installFakeStorage();
    store.set('svs.save.v1', '{not valid json');
    const data = loadSaveData();
    expect(data).toEqual(defaultSaveData());
  });

  it('falls back to defaults when stored content has the wrong shape', () => {
    installFakeStorage();
    localStorage.setItem('svs.save.v1', JSON.stringify({ version: 1, elonUnlocked: 'yes' }));
    const data = loadSaveData();
    expect(data).toEqual(defaultSaveData());
  });

  it('round-trips valid data', () => {
    installFakeStorage();
    const data = defaultSaveData();
    data.elonUnlocked = true;
    data.volumes.music = 0.3;
    saveSaveData(data);
    const loaded = loadSaveData();
    expect(loaded).toEqual(data);
  });
});
