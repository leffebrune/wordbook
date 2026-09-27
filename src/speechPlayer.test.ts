import { describe, expect, it, vi } from 'vitest';
import { idleSpeech, SpeechPlayer, type SpeechState } from './speechPlayer';
import { SpeechError } from './tts';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const tick = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function fixture() {
  let state: SpeechState = idleSpeech;
  const pending: ReturnType<typeof deferred<Blob>>[] = [];
  const audio = {
    src: '', onended: null as ((event: Event) => void) | null, onerror: null as OnErrorEventHandler,
    play: vi.fn().mockResolvedValue(undefined), pause: vi.fn(), load: vi.fn()
  };
  const deps = {
    settings: vi.fn().mockResolvedValue({ model: 'openai/gpt-4o-mini-tts-2025-12-15', voice: 'alloy' }),
    generate: vi.fn((_text: string, _settings: unknown, _key: string, _signal: AbortSignal) => {
      const job = deferred<Blob>(); pending.push(job); return job.promise;
    }),
    audio: () => audio,
    createUrl: vi.fn().mockReturnValue('blob:example'), revokeUrl: vi.fn()
  };
  const player = new SpeechPlayer(deps, next => { state = next; });
  return { player, audio, deps, pending, state: () => state };
}

describe('speech playback lifecycle', () => {
  it('deduplicates clicks and replays cached audio without another request', async () => {
    const f = fixture();
    f.player.read('a', 'Hello!', 'key'); f.player.read('a', 'Hello!', 'key');
    await tick(); expect(f.deps.generate).toHaveBeenCalledTimes(1);
    f.pending[0].resolve(new Blob(['audio'])); await tick();
    expect(f.state().phase).toBe('playing');
    f.player.read('a', 'Hello!', 'key'); expect(f.state().phase).toBe('idle');
    f.player.read('a', 'Hello!', 'key');
    expect(f.audio.play).toHaveBeenCalledTimes(2); // synchronous cached playback
    expect(f.deps.generate).toHaveBeenCalledTimes(1);
    expect(f.deps.settings).toHaveBeenCalledTimes(1);
    f.player.dispose();
  });
  it('never plays an older response after another example is selected', async () => {
    const f = fixture();
    f.player.read('a', 'A sentence.', 'key'); await tick();
    f.player.read('b', 'B sentence.', 'key'); await tick();
    f.pending[1].resolve(new Blob(['B'])); await tick();
    const oldEnded = f.audio.onended;
    f.pending[0].resolve(new Blob(['A'])); await tick();
    expect(f.audio.play).toHaveBeenCalledTimes(1);
    expect(f.state().id).toBe('b');
    f.player.read('a', 'A sentence.', 'key'); await tick();
    oldEnded?.(new Event('ended'));
    expect(f.state()).toMatchObject({ id: 'a', phase: 'playing' });
    expect(f.deps.generate).toHaveBeenCalledTimes(2);
    f.player.dispose();
  });
  it('reuses an in-flight request when switching back', async () => {
    const f = fixture();
    f.player.read('a', 'A.', 'key'); await tick();
    f.player.read('b', 'B.', 'key'); await tick();
    f.player.read('a', 'A.', 'key'); await tick();
    expect(f.deps.generate).toHaveBeenCalledTimes(2);
    f.pending[0].resolve(new Blob(['A'])); await tick();
    expect(f.audio.play).toHaveBeenCalledTimes(1);
    f.player.dispose();
  });
  it('suppresses delayed playback after editing, regrading, or unmounting', async () => {
    const f = fixture();
    f.player.read('a', 'A.', 'key'); await tick();
    f.player.stopIf('other'); expect(f.state().phase).toBe('loading');
    f.player.stopIf('a');
    f.pending[0].resolve(new Blob(['A'])); await tick();
    expect(f.audio.play).not.toHaveBeenCalled();
    f.player.read('b', 'B.', 'key'); await tick();
    const signal = f.deps.generate.mock.calls[1][3];
    f.player.dispose(); expect(signal.aborted).toBe(true);
    f.pending[1].resolve(new Blob(['B'])); await tick();
    expect(f.audio.play).not.toHaveBeenCalled();
  });
  it('lets a mobile user replay prepared audio directly after autoplay rejection', async () => {
    const f = fixture();
    f.audio.play.mockRejectedValueOnce(new DOMException('gesture needed', 'NotAllowedError'));
    f.player.read('a', 'A.', 'key'); await tick();
    f.pending[0].resolve(new Blob(['A'])); await tick();
    expect(f.state()).toMatchObject({ phase: 'ready' });
    f.player.read('a', 'A.', 'key');
    expect(f.audio.play).toHaveBeenCalledTimes(2);
    await tick(); expect(f.state().phase).toBe('playing');
    expect(f.deps.generate).toHaveBeenCalledTimes(1);
    f.audio.onended?.(new Event('ended'));
    expect(f.state().phase).toBe('idle');
    expect(f.deps.revokeUrl).toHaveBeenCalledTimes(2);
    f.player.dispose();
  });
  it('evicts failed requests, reloads invalid settings, and uses a changed key on retry', async () => {
    const f = fixture();
    f.player.read('a', 'A.', 'old-key'); await tick();
    f.pending[0].reject(new SpeechError('request', 400)); await tick();
    expect(f.state().phase).toBe('error');
    f.player.read('a', 'A.', 'new-key'); await tick();
    expect(f.deps.settings).toHaveBeenCalledTimes(2);
    expect(f.deps.generate.mock.calls[1][2]).toBe('new-key');
    f.player.dispose();
  });
  it('allows fixing missing sheet settings without reloading the app', async () => {
    const f = fixture();
    f.deps.settings.mockResolvedValueOnce({ model: '', voice: '' });
    f.player.read('a', 'A.', 'key'); await tick();
    expect(f.state().phase).toBe('error');
    expect(f.deps.generate).not.toHaveBeenCalled();
    f.player.read('a', 'A.', 'key'); await tick();
    expect(f.deps.generate).toHaveBeenCalledTimes(1);
    f.player.dispose();
  });
});
