import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadApiKey, saveApiKey } from './settings';

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); }
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('device API key', () => {
  it('persists and replaces a trimmed key across module reloads', async () => {
    expect(loadApiKey()).toBe('');
    saveApiKey('  first-test-key  ');
    vi.resetModules();
    const reloaded = await import('./settings');
    expect(reloaded.loadApiKey()).toBe('first-test-key');
    reloaded.saveApiKey('replacement-test-key');
    expect(loadApiKey()).toBe('replacement-test-key');
  });

  it('deletes only the key and preserves answer drafts', () => {
    localStorage.setItem('wordbook.drafts.v1', '{"answer":"받다"}');
    saveApiKey('test-key');
    saveApiKey(' ');
    expect(loadApiKey()).toBe('');
    expect(localStorage.getItem('wordbook.drafts.v1')).toBe('{"answer":"받다"}');
  });

  it('handles unavailable storage without pretending a save succeeded', () => {
    const denied = () => { throw new Error('Storage denied'); };
    vi.stubGlobal('localStorage', { getItem: denied, setItem: denied, removeItem: denied });
    expect(loadApiKey()).toBe('');
    expect(() => saveApiKey('test-key')).toThrow('Storage denied');
    expect(() => saveApiKey('')).toThrow('Storage denied');
  });
});
