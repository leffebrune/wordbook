import { afterEach, describe, expect, it, vi } from 'vitest';
import { speechRequest, speechCacheKey, synthesizeSpeech, speechErrorMessage } from './tts';
const settings = { model: 'openai/gpt-4o-mini-tts-2025-12-15', voice: 'alloy' };
const signal = () => new AbortController().signal;
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('speech API', () => {
  it('sends only the English example as input, with separate delivery instructions and existing key', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('audio', { headers: { 'content-type': 'audio/mpeg' } }));
    vi.stubGlobal('fetch', fetchMock);
    expect((await synthesizeSpeech('Can I take this?', settings, 'test-key', signal())).size).toBe(5);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('https://openrouter.ai/api/v1/audio/speech');
    expect(options.headers.Authorization).toBe('Bearer test-key');
    expect(JSON.parse(options.body)).toMatchObject({ input: 'Can I take this?', ...settings, response_format: 'mp3' });
    expect(options.body).not.toContain('test-key');
    expect(JSON.parse(options.body).provider.options.openai.instructions).toContain('natural sentence stress');
  });
  it('does not send OpenAI-specific options to other models', () => {
    expect(speechRequest('Hello!', { model: 'mistralai/voxtral-mini-tts-2603', voice: 'en_paul_neutral' })).not.toHaveProperty('provider');
  });
  it('keys the cache by sentence, model, voice and delivery settings', () => {
    const initial = speechCacheKey('Hello!', settings);
    expect(initial).not.toBe(speechCacheKey('Hi!', settings));
    expect(initial).not.toBe(speechCacheKey('Hello!', { ...settings, voice: 'nova' }));
    expect(initial).not.toBe(speechCacheKey('Hello!', { ...settings, model: 'openai/tts-1' }));
  });
  it('rejects missing settings or keys before a paid request', async () => {
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    await expect(synthesizeSpeech('Hello', { model: '', voice: '' }, 'key', signal())).rejects.toMatchObject({ kind: 'settings' });
    await expect(synthesizeSpeech('Hello', settings, '', signal())).rejects.toMatchObject({ kind: 'auth' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each([[401, 'auth'], [402, 'credits'], [403, 'forbidden'], [404, 'request'], [429, 'rate-limit'], [503, 'service']])('handles HTTP %s', async (status, kind) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('private error', { status: Number(status) })));
    const error = await synthesizeSpeech('Hello', settings, 'key', signal()).catch(error => error);
    expect(error).toMatchObject({ kind });
    expect(speechErrorMessage(error)).not.toContain('private error');
  });
  it('rejects JSON errors with HTTP 200 and empty audio', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ error: { code: 402, message: 'private' } }))
      .mockResolvedValueOnce(new Response('', { headers: { 'content-type': 'audio/mpeg' } }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(synthesizeSpeech('Hello', settings, 'key', signal())).rejects.toMatchObject({ kind: 'credits' });
    await expect(synthesizeSpeech('Hello', settings, 'key', signal())).rejects.toMatchObject({ kind: 'format' });
  });
  it('times out without automatically retrying', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn((_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    }));
    vi.stubGlobal('fetch', fetchMock);
    const request = expect(synthesizeSpeech('Hello', settings, 'key', signal())).rejects.toMatchObject({ kind: 'timeout' });
    await vi.advanceTimersByTimeAsync(30_000);
    await request;
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('Gemini 3.8 TTS request and response', () => {
  const gemini = { model: 'google/gemini-3.8-flash-tts', voice: 'Zephyr' };
  it.each(['google/gemini-3.8-flash-tts', 'google/gemini-3.8-flash-lite-tts'])('requests PCM and separate speech metadata for %s', model => {
    const request = speechRequest('Can I take this?', { ...gemini, model });
    expect(request).toMatchObject({ model, voice: 'Zephyr', input: 'Can I take this?', response_format: 'pcm' });
    expect(request).toHaveProperty('provider.options.google-ai-studio.speech_metadata.style');
    expect(request).not.toHaveProperty('provider.options.openai');
  });
  it.each(['audio/pcm', 'audio/L16;codec=pcm;rate=24000', 'application/octet-stream'])('converts %s to playable WAV', async contentType => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(new Uint8Array([0, 0, 255, 127]), { headers: { 'content-type': contentType } }));
    vi.stubGlobal('fetch', fetchMock);
    const audio = await synthesizeSpeech('Hello!', gemini, 'key', signal());
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).response_format).toBe('pcm');
    expect(audio.type).toBe('audio/wav');
    expect(audio.size).toBe(48);
    expect(new TextDecoder().decode((await audio.arrayBuffer()).slice(0, 4))).toBe('RIFF');
  });
  it('preserves WAV responses instead of interpreting their header as samples', async () => {
    const { pcmToWav } = await import('./speechAudio');
    const wav = pcmToWav(new Uint8Array([0, 0, 255, 127]).buffer);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(wav, { headers: { 'content-type': 'audio/wav' } })));
    const result = await synthesizeSpeech('Hello!', gemini, 'key', signal());
    expect(await result.arrayBuffer()).toEqual(await wav.arrayBuffer());
  });
  it('shows model and requested format for rejected requests without blaming sheet cells', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('private provider detail', { status: 400 })));
    const error = await synthesizeSpeech('Hello!', gemini, 'key', signal()).catch(error => error);
    const message = speechErrorMessage(error);
    expect(message).toContain('오류 400');
    expect(message).toContain(gemini.model);
    expect(message).toContain('pcm');
    expect(message).not.toContain('E2');
    expect(message).not.toContain('private provider detail');
  });
});
