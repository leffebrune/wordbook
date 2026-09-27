// Gemini TTS PCM is signed 16-bit little-endian, mono, 24 kHz by default.
// Wrap raw samples in WAV so HTMLAudioElement can decode them on mobile too.
export function pcmToWav(pcm: ArrayBuffer, sampleRate = 24_000, channels = 1): Blob {
  if (!pcm.byteLength || pcm.byteLength % (channels * 2) !== 0 ||
      !Number.isInteger(sampleRate) || sampleRate < 8_000 || sampleRate > 192_000 ||
      !Number.isInteger(channels) || channels < 1 || channels > 2) {
    throw new Error('Invalid PCM audio');
  }
  const header = new ArrayBuffer(44);
  const view = new DataView(header);
  const text = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
  };
  text(0, 'RIFF'); view.setUint32(4, 36 + pcm.byteLength, true);
  text(8, 'WAVE'); text(12, 'fmt '); view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, channels, true); view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true); view.setUint16(34, 16, true);
  text(36, 'data'); view.setUint32(40, pcm.byteLength, true);
  return new Blob([header, pcm], { type: 'audio/wav' });
}

export function hasWavHeader(buffer: ArrayBuffer): boolean {
  if (buffer.byteLength < 44) return false;
  const bytes = new Uint8Array(buffer);
  const text = (start: number, length: number) => String.fromCharCode(...bytes.slice(start, start + length));
  return text(0, 4) === 'RIFF' && text(8, 4) === 'WAVE';
}

export function geminiAudioToWav(buffer: ArrayBuffer, contentType: string): Blob {
  // Some providers return a WAV container even for a PCM request. Do not add a second header.
  if (hasWavHeader(buffer)) return new Blob([buffer], { type: 'audio/wav' });
  if (/^audio\/(?:wav|wave|x-wav)(?:;|$)/i.test(contentType)) throw new Error('Invalid WAV audio');
  const params = new Map(contentType.split(';').slice(1).map(part => {
    const [key, value] = part.trim().toLowerCase().split('=');
    return [key, value?.replace(/^"|"$/g, '')];
  }));
  const rate = params.get('rate') ?? params.get('samplerate') ?? params.get('sample_rate');
  const channels = params.get('channels');
  const bits = params.get('bits') ?? params.get('bitdepth');
  if (bits !== undefined && bits !== '16') throw new Error('Unsupported PCM depth');
  return pcmToWav(buffer, rate === undefined ? 24_000 : Number(rate), channels === undefined ? 1 : Number(channels));
}
