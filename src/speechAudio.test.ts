import { describe, expect, it } from 'vitest';
import { geminiAudioToWav, pcmToWav } from './speechAudio';

describe('Gemini PCM playback', () => {
  const samples = new Uint8Array([0, 0, 255, 127, 0, 128, 255, 255]).buffer;
  it('preserves signed little-endian samples and writes a 24 kHz mono 16-bit WAV header', async () => {
    const wav = pcmToWav(samples);
    const data = await wav.arrayBuffer();
    const view = new DataView(data);
    expect(wav.type).toBe('audio/wav');
    expect(data.byteLength).toBe(52);
    expect(new TextDecoder().decode(data.slice(0, 4))).toBe('RIFF');
    expect(new TextDecoder().decode(data.slice(8, 12))).toBe('WAVE');
    expect(view.getUint32(4, true)).toBe(44);
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(24000);
    expect(view.getUint32(28, true)).toBe(48000);
    expect(view.getUint16(32, true)).toBe(2);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getUint32(40, true)).toBe(samples.byteLength);
    expect(new Uint8Array(data.slice(44))).toEqual(new Uint8Array(samples));
  });
  it('does not wrap an existing WAV a second time, even when labelled PCM', async () => {
    const existing = await pcmToWav(samples).arrayBuffer();
    for (const type of ['audio/wav', 'audio/pcm']) {
      expect(await geminiAudioToWav(existing, type).arrayBuffer()).toEqual(existing);
    }
  });
  it('respects declared sample rate and channels', async () => {
    const wav = await geminiAudioToWav(samples, 'audio/L16;codec=pcm;rate=48000;channels=2').arrayBuffer();
    const header = new DataView(wav);
    expect(header.getUint32(24, true)).toBe(48000);
    expect(header.getUint16(22, true)).toBe(2);
    expect(header.getUint32(28, true)).toBe(192000);
  });
  it('rejects empty, truncated and unsupported audio instead of playing noise', () => {
    expect(() => pcmToWav(new ArrayBuffer(0))).toThrow();
    expect(() => pcmToWav(new ArrayBuffer(3))).toThrow();
    expect(() => geminiAudioToWav(samples, 'audio/wav')).toThrow();
    expect(() => geminiAudioToWav(samples, 'audio/pcm;rate=0')).toThrow();
    expect(() => geminiAudioToWav(samples, 'audio/pcm;bits=32')).toThrow();
    expect(() => geminiAudioToWav(samples, 'audio/pcm;channels=3')).toThrow();
  });
});
